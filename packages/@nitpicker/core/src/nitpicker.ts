import type { PageAnalysisWorkerData } from './page-analysis-worker.js';
import type {
	AnalyzeOptions,
	Config,
	NitpickerEvent,
	PluginOverrides,
	ReportPage,
	TableData,
} from './types.js';
import type { ProgressEvent } from '@d-zero/page-cluster/resolve-page-cluster-keys';
import type { Page } from '@nitpicker/crawler';
import type { Report, Violation } from '@nitpicker/types';

import os from 'node:os';
import path from 'node:path';

import { Cache } from '@d-zero/shared/cache';
import { TypedAwaitEventEmitter as EventEmitter } from '@d-zero/shared/typed-await-event-emitter';
import { Archive } from '@nitpicker/crawler';
import c from 'ansi-colors';

import { getTableCacheRoot } from './get-table-cache-root.js';
import { importModules } from './import-modules.js';
import { loadPluginSettings } from './load-plugin-settings.js';
import { Table } from './table.js';
import { classifyPageTemplates } from './template-classification/classify-page-templates.js';
import { UrlEventBus } from './url-event-bus.js';
import { WorkerPool } from './worker/worker-pool.js';

export { definePlugin } from './hooks/define-plugin.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

/**
 * Resolved path to the compiled per-page analysis module.
 * Each task posted to the pool carries this path so the worker can
 * dynamically import it (cached after first import).
 * @see {@link ./page-analysis-worker.ts} for the source
 */
const pageAnalysisWorkerPath = path.resolve(__dirname, 'page-analysis-worker.js');

/**
 * Resolved path to the compiled long-lived worker thread script.
 * Used as the `workerPath` when constructing {@link WorkerPool} instances.
 */
const workerPath = path.resolve(__dirname, 'worker/worker.js');

/**
 * Default concurrency used when a plugin does not declare its own value.
 * Tracks the number of CPU cores so that worker pools scale with the host.
 */
const DEFAULT_CONCURRENCY = Math.max(1, os.cpus().length);

/**
 * Renders a `@d-zero/page-cluster` `ProgressEvent` as a short, human-readable
 * fragment for the Lanes template-classification lane, including a
 * done/total percentage wherever the event carries both halves of one
 * (matching the `N/M (X%)` convention every other lane in this file uses).
 * `pass0-signals` and `stage-b-start` carry only a running count with no
 * corpus-wide total, so those two render count-only.
 * @param event - Progress event forwarded from `resolvePageClusterKeys`.
 * @returns A short status fragment, e.g. `"42/100 blocks (42%)"`.
 */
function formatTemplateClassificationProgress(event: ProgressEvent): string {
	switch (event.phase) {
		case 'pass0-signals': {
			return `reading pages (${event.pagesSeen})`;
		}
		case 'pass1-block-complete': {
			const percent = Math.round((event.blocksProcessed / event.totalBlocks) * 100);
			return `${event.blocksProcessed}/${event.totalBlocks} blocks (${percent}%)`;
		}
		case 'pass1b-assign': {
			const percent = Math.round((event.pagesAssigned / event.pagesToAssign) * 100);
			return `${event.pagesAssigned}/${event.pagesToAssign} pages (${percent}%)`;
		}
		case 'stage-b-start': {
			return `merging ${event.unitCount} units`;
		}
	}
}

/**
 * Core orchestrator for running analyze plugins against a `.nitpicker` archive.
 *
 * Nitpicker opens an existing archive (produced by the crawler), loads the
 * user's plugin configuration via cosmiconfig, then runs each plugin against
 * every page in the archive. Results are stored back into the archive as
 * `analysis/report`, `analysis/table`, and SQL-backed analysis violation
 * tables via the archive facade.
 *
 * ## Architecture decisions
 *
 * - **Worker pool per plugin**: Each plugin gets its own long-lived
 *   {@link ./worker/worker-pool.ts!WorkerPool}, sized by either the plugin's
 *   declared `concurrency` or {@link DEFAULT_CONCURRENCY} (CPU core count).
 *   Workers are spawned once and reused across every page, so the V8 isolate
 *   / JSDOM module / plugin module boot cost is paid only `concurrency`
 *   times per plugin instead of once per page.
 *
 * - **Plugin-outer, page-inner loop**: Plugins are processed sequentially.
 *   For each plugin, pages are submitted to that plugin's pool, which queues
 *   them and dispatches to idle workers. This enables per-plugin progress
 *   tracking via {@link https://www.npmjs.com/package/@d-zero/dealer | Lanes}.
 *
 * - **Cache layer**: Results are cached per `pluginName:url` using
 *   `@d-zero/shared/cache` so that re-running analysis after a partial failure
 *   skips already-processed pages. The cache is cleared at the start of each run.
 * @example
 * ```ts
 * import { Nitpicker } from '@nitpicker/core';
 *
 * // Open an existing archive — `Symbol.asyncDispose` closes it on scope exit
 * await using nitpicker = await Nitpicker.open('./example.nitpicker');
 *
 * // Run all configured analyze plugins
 * await nitpicker.analyze();
 *
 * // Or run only specific plugins by name
 * await nitpicker.analyze(['@nitpicker/analyze-axe']);
 *
 * // Write updated archive back to disk
 * await nitpicker.write();
 * ```
 * @see {@link ./types.ts!NitpickerEvent} for emitted events
 * @see {@link ./types.ts!Config} for the resolved configuration model
 */
export class Nitpicker extends EventEmitter<NitpickerEvent> {
	/**
	 * The underlying archive instance providing access to the SQLite database
	 * and file storage. Injected via constructor or created by `Nitpicker.open()`.
	 */
	readonly #archive: Archive;

	/**
	 * Lazily loaded and cached plugin configuration.
	 * `null` until `getConfig()` is first called.
	 */
	#config: Config | null = null;

	/**
	 * CLI-specified plugin setting overrides.
	 * Passed to `loadPluginSettings()` to merge with config-file settings.
	 */
	#pluginOverrides: PluginOverrides = {};

	/** The underlying archive instance. */
	get archive() {
		return this.#archive;
	}

	/**
	 * @param archive - An opened {@link Archive} instance to analyze.
	 *   Use {@link Nitpicker.open} for a convenient static factory.
	 */
	constructor(archive: Archive) {
		super();
		this.#archive = archive;
	}

	/**
	 * Enables `await using nitpicker = ...`. Delegates to the wrapped
	 * archive's `Symbol.asyncDispose` (i.e. {@link Archive.close}).
	 */
	async [Symbol.asyncDispose](): Promise<void> {
		await this.#archive.close();
	}

	/**
	 * Runs all configured analyze plugins (or a filtered subset) against
	 * every page in the archive.
	 *
	 * Plugins are processed **sequentially** (one at a time). For each plugin,
	 * pages are processed in **parallel** through a dedicated long-lived
	 * {@link ./worker/worker-pool.ts!WorkerPool} sized either by the plugin's
	 * declared concurrency or by {@link DEFAULT_CONCURRENCY}. This architecture
	 * enables per-plugin progress tracking via Lanes.
	 *
	 * The analysis proceeds in up to three phases:
	 *
	 * 1. **`eachPage` phase** - For each plugin with `eachPage`, dispatches
	 *    page analysis tasks to the plugin's worker pool. Progress is
	 *    displayed via Lanes if provided in options.
	 *
	 * 2. **`eachUrl` phase** - For all plugins with `eachUrl`, runs
	 *    sequentially in the main thread. These are lightweight checks
	 *    that don't need DOM access.
	 *
	 * 3. **Template classification phase** (opt-in via
	 *    {@link AnalyzeOptions.classifyTemplates}) - Classifies every internal
	 *    HTML page into a template group by DOM-structure similarity. Unlike
	 *    phases 1-2 this is not a discovered `@nitpicker/analyze-*` plugin; it
	 *    runs once, globally, after every batch from phases 1-2 has been
	 *    accumulated (see `accumulatedPages` below for why it cannot run
	 *    per-batch).
	 *
	 * On completion, data entries are stored in the archive:
	 * - `analysis/report` - Full {@link Report} with headers and data
	 * - `analysis/table` - The raw {@link Table} instance (serialized)
	 * - SQL-backed analysis violation tables - Flat {@link Violation} records
	 * - `page_templates` SQL table - `templateKey` per page, written via
	 *   `Archive.replacePageTemplates` and never round-tripped through
	 *   `Table`/`Report`
	 *
	 * When `filter` resolves to zero plugins (only reachable when
	 * `classifyTemplates` is the sole reason for this call — see
	 * `cli/src/commands/analyze.ts`'s `--templates`-only bypass), this call
	 * contributes no plugin data of its own. To avoid silently wiping every
	 * column and violation from a *previous* run's plugins, this case skips
	 * `replaceAnalysisViolations` entirely and seeds the new `Table` from the
	 * archive's existing `analysis/report` (if any). This does not apply when
	 * one or more plugins ran: running a different plugin subset than a prior
	 * call has always fully replaced the report/table/violations with that
	 * subset's output, and that established contract is unchanged here.
	 * @param filter - Optional list of plugin module names to run.
	 *   If omitted, all configured plugins are executed.
	 * @param options - Optional settings for progress display.
	 * @example
	 * ```ts
	 * // Run all plugins
	 * await nitpicker.analyze();
	 *
	 * // Run only axe and markuplint with Lanes progress
	 * await nitpicker.analyze(
	 *   ['@nitpicker/analyze-axe', '@nitpicker/analyze-markuplint'],
	 *   { lanes },
	 * );
	 * ```
	 */
	async analyze(filter?: string[], options?: AnalyzeOptions) {
		const config = await this.getConfig();
		const plugins = filter
			? config.analyze.filter((plugin) => filter?.includes(plugin.name))
			: config.analyze;

		const analyzeMods = await importModules(plugins);
		const lanes = options?.lanes;

		const table = new Table();

		if (plugins.length === 0) {
			// Only reachable via `--templates` with zero configured/selected
			// plugins (see this method's JSDoc). Seed from whatever
			// `analysis/report` already exists so this run — which contributes
			// no plugin data of its own — doesn't wipe a previous run's columns.
			try {
				const previousReport = await this.archive.getData<Report>('analysis/report');
				if (previousReport.pageData) {
					table.addHeaders(previousReport.pageData.headers);
					table.addData(previousReport.pageData.data);
				}
			} catch (error) {
				// ENOENT (no previous `analysis/report` — e.g. first analyze()
				// call ever on this archive) is expected and starting from an
				// empty table is correct. Anything else (corrupted JSON,
				// permission error) is not silently swallowed: emit it so the
				// user knows a previous run's data may not have been preserved,
				// while still proceeding rather than blocking this run entirely.
				if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
					const message = error instanceof Error ? error.message : String(error);
					await this.emit('error', {
						message: `Failed to read previous analysis/report before a zero-plugin run: ${message}`,
						error: error instanceof Error ? error : null,
					});
				}
			}
		}

		for (const mod of analyzeMods) {
			if (!mod.headers) {
				continue;
			}
			if (!mod.eachPage) {
				continue;
			}

			table.addHeaders(mod.headers);
		}

		const allViolations: Violation[] = [];
		const cache = new Cache<{
			pages?: Record<string, TableData<string>>;
			violations?: Violation[];
		}>('nitpicker-axe', getTableCacheRoot());

		await cache.clear();

		// Build plugin metadata: lane IDs and display labels
		const eachPagePlugins: Array<{ plugin: (typeof plugins)[number]; modIndex: number }> =
			[];
		for (const [i, plugin] of plugins.entries()) {
			if (analyzeMods[i]?.eachPage) {
				eachPagePlugins.push({ plugin, modIndex: i });
			}
		}

		const pluginLaneIds = new Map<string, number>();
		const pluginLabels = new Map<string, string>();
		const pluginCompletionDetails = new Map<string, string>();

		for (const [laneId, { plugin, modIndex }] of eachPagePlugins.entries()) {
			pluginLaneIds.set(plugin.name, laneId);
			pluginLabels.set(plugin.name, analyzeMods[modIndex]?.label ?? plugin.name);
		}

		// Initialize all lanes as Waiting
		for (const [name, id] of pluginLaneIds) {
			const label = pluginLabels.get(name) ?? name;
			lanes?.update(id, c.dim(`${label}: Waiting...`));
		}

		// Template classification (opt-in, `--templates`) is a corpus-wide batch
		// computation, not a per-page `AnalyzePlugin`, so it has its own lane
		// outside `pluginLaneIds` and does not go through `analyzeMods`/`Worker`.
		const templateClassificationLaneId = options?.classifyTemplates
			? eachPagePlugins.length
			: null;
		if (templateClassificationLaneId != null) {
			lanes?.update(
				templateClassificationLaneId,
				c.dim('Template classification: Waiting...'),
			);
		}

		// Accumulated across every `getPagesWithRefs` batch so template
		// classification runs once, globally, after the loop below completes —
		// never per-batch. Per-batch classification would produce template keys
		// that are only comparable within their own batch (see
		// `classifyPageTemplates`'s caller contract). `Page` instances are
		// lightweight handles (HTML is fetched lazily via `getHtml()`), so
		// accumulating every page across a 100,000-page batch size is not an
		// OOM risk even for archives with hundreds of thousands of pages.
		const accumulatedPages: Page[] = [];

		await this.archive.getPagesWithRefs(
			100_000,
			async (pages) => {
				if (options?.classifyTemplates) {
					// Avoid `push(...pages)`: a 100,000-page batch can overflow V8's
					// argument-spread limit even though the data itself fits in memory.
					for (const page of pages) {
						accumulatedPages.push(page);
					}
				}

				const urlEmitter = new UrlEventBus();

				// Phase 1: eachPage plugins (sequentially, pages in parallel)
				for (const [pluginSeqIndex, { plugin, modIndex }] of eachPagePlugins.entries()) {
					const laneId = pluginLaneIds.get(plugin.name)!;
					const label = pluginLabels.get(plugin.name) ?? plugin.name;
					let done = 0;
					let pluginViolationCount = 0;

					const updateProgress = () => {
						const pluginPercent = Math.round((done / pages.length) * 100);
						const overallPercent = Math.round(
							((pluginSeqIndex + done / pages.length) / eachPagePlugins.length) * 100,
						);
						lanes?.header(
							`[${pluginSeqIndex + 1}/${eachPagePlugins.length}] Analyzing (${overallPercent}%)`,
						);
						lanes?.update(
							laneId,
							`${label}: ${done}/${pages.length} (${pluginPercent}%)%braille%`,
						);
					};

					updateProgress();

					const pluginConcurrency = Math.max(
						1,
						analyzeMods[modIndex]?.concurrency ?? DEFAULT_CONCURRENCY,
					);
					const pool = new WorkerPool({
						size: pluginConcurrency,
						workerPath,
					});
					let pluginPageDataCount = 0;
					let pluginErrorCount = 0;

					try {
						// Bound the number of in-flight IIFEs so HTML strings loaded
						// via page.getHtml() do not pile up on the main thread while
						// they wait for a worker. A small buffer above pool size keeps
						// the pool continuously fed without staging too much HTML.
						const inFlight = new Set<Promise<void>>();
						const highWater = pluginConcurrency * 2;

						for (const [pageIndex, page] of pages.entries()) {
							const task = (async () => {
								try {
									const cacheKey = `${plugin.name}:${page.url.href}`;
									const cached = await cache.load(cacheKey);
									if (cached) {
										const { pages: cachedPages, violations } = cached;
										if (cachedPages) {
											table.addData(cachedPages);
											pluginPageDataCount += Object.keys(cachedPages).length;
										}
										if (violations) {
											for (const v of violations) {
												allViolations.push(v);
											}
											pluginViolationCount += violations.length;
										}
										done++;
										updateProgress();
										return;
									}

									const html = await page.getHtml();
									if (!html) {
										done++;
										updateProgress();
										return;
									}

									const report = await pool.run<
										PageAnalysisWorkerData,
										ReportPage<string> | null
									>({
										filePath: pageAnalysisWorkerPath,
										num: pageIndex,
										total: pages.length,
										emitter: urlEmitter,
										initialData: {
											plugin,
											pages: {
												html,
												url: page.url,
											},
										},
									});

									const tablePages: Record<string, TableData<string>> = {};

									if (report?.page) {
										tablePages[page.url.href] = report.page;
										table.addDataToUrl(page.url, report.page);
										pluginPageDataCount++;
									}

									await cache.store(cacheKey, {
										pages: Object.keys(tablePages).length > 0 ? tablePages : undefined,
										violations: report?.violations,
									});

									if (report?.violations) {
										for (const v of report.violations) {
											allViolations.push(v);
										}
										pluginViolationCount += report.violations.length;
									}

									done++;
									updateProgress();
								} catch (error) {
									pluginErrorCount++;
									done++;
									updateProgress();
									const message = error instanceof Error ? error.message : String(error);
									await this.emit('error', {
										message: `[${plugin.name}] Failed to analyze ${page.url.href}: ${message}`,
										error: error instanceof Error ? error : null,
									});
								}
							})();
							inFlight.add(task);
							task.then(
								() => inFlight.delete(task),
								() => inFlight.delete(task),
							);
							if (inFlight.size >= highWater) {
								await Promise.race(inFlight);
							}
						}

						await Promise.all(inFlight);
					} finally {
						await pool.terminate();
					}

					// Warn when plugin produced no page data at all
					if (pluginPageDataCount === 0 && pages.length > 0) {
						const errorDetail =
							pluginErrorCount > 0 ? ` (${pluginErrorCount} errors occurred)` : '';
						await this.emit('error', {
							message: `[${plugin.name}] Produced no data for ${pages.length} pages${errorDetail}. Check plugin configuration and HTML snapshots.`,
							error: null,
						});
					}

					// Mark this plugin as Done
					const detail =
						pluginViolationCount > 0
							? `${pluginViolationCount} violations`
							: `${done} pages`;
					pluginCompletionDetails.set(plugin.name, detail);
					lanes?.update(laneId, c.green(`${label}: Done (${detail})`));

					// Dim inactive lanes
					for (const [name, id] of pluginLaneIds) {
						if (name === plugin.name) {
							continue;
						}
						const otherLabel = pluginLabels.get(name) ?? name;
						const completionDetail = pluginCompletionDetails.get(name);
						if (completionDetail) {
							lanes?.update(id, c.dim(`${otherLabel}: Done (${completionDetail})`));
						} else {
							lanes?.update(id, c.dim(`${otherLabel}: Waiting...`));
						}
					}
				}

				// Phase 2: eachUrl plugins (main thread, sequential)
				for (const page of pages) {
					const url = page.url;
					const isExternal = page.isExternal;

					for (const mod of analyzeMods) {
						if (!mod.eachUrl) {
							continue;
						}

						try {
							const report = await mod.eachUrl({ url, isExternal });
							if (!report) {
								continue;
							}

							const { page: reportPage, violations } = report;

							if (reportPage) {
								table.addDataToUrl(url, reportPage);
							}

							if (violations) {
								for (const v of violations) {
									allViolations.push(v);
								}
							}
						} catch (error) {
							const message = error instanceof Error ? error.message : String(error);
							await this.emit('error', {
								message: `[eachUrl] Failed to analyze ${url.href}: ${message}`,
								error: error instanceof Error ? error : null,
							});
						}
					}
				}
			},
			{
				withRefs: false,
			},
		);

		// Phase 3: template classification (opt-in). Deliberately outside the
		// `getPagesWithRefs` loop above — it must run once, globally, over every
		// accumulated page, not once per 100,000-page batch (see
		// `accumulatedPages`'s JSDoc comment).
		//
		// Wrapped in try/catch (unlike phases 1-2, whose failures are already
		// caught per-page/per-mod) because this phase has no finer-grained
		// unit to catch around: a failure here must not discard the
		// already-computed `table`/`allViolations` from phases 1-2, which are
		// persisted in the unconditional tail below regardless of this
		// phase's outcome.
		if (templateClassificationLaneId != null) {
			try {
				const classification = await classifyPageTemplates({
					archive: this.archive,
					pages: accumulatedPages,
					// Only worth paying for when there's a lane to update —
					// passing a defined callback at all (even a no-op one)
					// demotes `resolvePageClusterKeys` off its byte-identical,
					// yield-overhead-free sync path for corpora at or below its
					// inline threshold (see @d-zero/page-cluster's own docs).
					// `classifyPageTemplates` always requests cluster reasons too,
					// independent of this — see its own JSDoc for why that no
					// longer costs the sync-path demotion this comment warns about.
					onProgress: lanes
						? (event) => {
								lanes.update(
									templateClassificationLaneId,
									`Template classification: ${formatTemplateClassificationProgress(event)}%braille%`,
								);
							}
						: undefined,
				});
				if (classification.templateKeysByUrl.size > 0) {
					await this.archive.replacePageTemplates(
						classification.templateKeysByUrl,
						classification.clusterReasonsByTemplateKey,
					);
				}
				lanes?.update(
					templateClassificationLaneId,
					c.green(
						`Template classification: Done (${classification.templateKeysByUrl.size} pages)`,
					),
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				lanes?.update(
					templateClassificationLaneId,
					c.red(`Template classification: Failed (${message})`),
				);
				await this.emit('error', {
					message: `[template classification] ${message}`,
					error: error instanceof Error ? error : null,
				});
			}
		}

		const report: Report = {
			name: 'general',
			pageData: table.toJSON(),
		};

		await this.archive.setData('analysis/report', report);
		await this.archive.setData('analysis/table', table);

		// See this method's JSDoc: a zero-plugin call (only reachable via
		// `--templates` alone) contributes no violations of its own, so
		// replacing the whole table with an empty array would silently erase
		// every violation a previous run's plugins stored.
		if (plugins.length > 0) {
			await this.archive.replaceAnalysisViolations(allViolations);
		}
	}

	/**
	 * Loads and caches the plugin configuration from the user's config file.
	 *
	 * Uses cosmiconfig to search for `.nitpickerrc`, `.nitpickerrc.json`,
	 * `nitpicker.config.js`, or a `nitpicker` key in `package.json`.
	 * The result is cached after the first call.
	 * @returns Resolved {@link Config} with the `analyze` plugin list.
	 */
	async getConfig() {
		if (!this.#config) {
			this.#config = await loadPluginSettings({}, this.#pluginOverrides);
		}

		return this.#config;
	}
	/**
	 * Sets CLI-specified plugin overrides that take precedence over
	 * config-file settings.
	 *
	 * Must be called before {@link getConfig} to take effect. If config
	 * has already been loaded, calling this method clears the cache so
	 * that the next `getConfig()` call re-loads with the new overrides.
	 * @param overrides - Plugin setting overrides from CLI flags.
	 */
	setPluginOverrides(overrides: PluginOverrides) {
		this.#pluginOverrides = overrides;
		this.#config = null;
	}

	/**
	 * Writes the archive (including any new analysis results) to disk
	 * as a `.nitpicker` tar file, then emits a `writeFile` event.
	 * @fires NitpickerEvent#writeFile
	 */
	async write() {
		await this.#archive.write();
		await this.emit('writeFile', { filePath: this.#archive.filePath });
	}

	/**
	 * Opens an existing `.nitpicker` archive file and returns a ready-to-use
	 * Nitpicker instance.
	 *
	 * This is the recommended way to create a Nitpicker instance. It extracts
	 * the archive to a temporary directory, opens the SQLite database, and
	 * enables plugin data access.
	 * @param filePath - Path to the `.nitpicker` archive file.
	 * @returns A new Nitpicker instance backed by the opened archive.
	 * @example
	 * ```ts
	 * const nitpicker = await Nitpicker.open('./site.nitpicker');
	 * await nitpicker.analyze();
	 * await nitpicker.write();
	 * ```
	 */
	static async open(filePath: string) {
		const archive = await Archive.open({ filePath, openPluginData: true });
		return new Nitpicker(archive);
	}
}
