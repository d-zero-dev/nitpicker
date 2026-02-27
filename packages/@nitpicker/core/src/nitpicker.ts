import type { PageAnalysisWorkerData } from './page-analysis-worker.js';
import type {
	AnalyzeOptions,
	Config,
	NitpickerEvent,
	ReportPage,
	TableData,
} from './types.js';
import type { Report, Violation } from '@nitpicker/types';

import os from 'node:os';
import path from 'node:path';

import { Cache } from '@d-zero/shared/cache';
import { TypedAwaitEventEmitter as EventEmitter } from '@d-zero/shared/typed-await-event-emitter';
import { Archive } from '@nitpicker/crawler';
import c from 'ansi-colors';

import { importModules } from './import-modules.js';
import { loadPluginSettings } from './load-plugin-settings.js';
import { Table } from './table.js';
import { UrlEventBus } from './url-event-bus.js';
import { runInWorker } from './worker/run-in-worker.js';

export { definePlugin } from './hooks/define-plugin.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

/**
 * Resolved path to the compiled Worker entry point.
 * This file is loaded by `runInWorker()` in a `new Worker(...)` call.
 * @see {@link ./page-analysis-worker.ts} for the source
 */
const pageAnalysisWorkerPath = path.resolve(__dirname, 'page-analysis-worker.js');

/** Maximum number of concurrent Worker threads per plugin. */
const CONCURRENCY_LIMIT = 50;

/**
 * Core orchestrator for running analyze plugins against a `.nitpicker` archive.
 *
 * Nitpicker opens an existing archive (produced by the crawler), loads the
 * user's plugin configuration via cosmiconfig, then runs each plugin against
 * every page in the archive. Results are stored back into the archive as
 * `analysis/report`, `analysis/table`, and `analysis/violations`.
 *
 * ## Architecture decisions
 *
 * - **Worker threads for `eachPage`**: DOM-heavy analysis (JSDOM + axe-core,
 *   markuplint, etc.) runs in isolated Worker threads so that a crashing plugin
 *   cannot take down the main process and memory from JSDOM windows is reclaimed
 *   when the Worker exits. See {@link ./worker/run-in-worker.ts!runInWorker}.
 *
 * - **Plugin-outer, page-inner loop**: Plugins are processed sequentially,
 *   and for each plugin, pages are processed in parallel (limit: 50) using
 *   a bounded Promise pool. This enables per-plugin progress tracking via
 *   {@link https://www.npmjs.com/package/@d-zero/dealer | Lanes}.
 *
 * - **Cache layer**: Results are cached per `pluginName:url` using
 *   `@d-zero/shared/cache` so that re-running analysis after a partial failure
 *   skips already-processed pages. The cache is cleared at the start of each run.
 * @example
 * ```ts
 * import { Nitpicker } from '@nitpicker/core';
 *
 * // Open an existing archive
 * const nitpicker = await Nitpicker.open('./example.nitpicker');
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
	 * Runs all configured analyze plugins (or a filtered subset) against
	 * every page in the archive.
	 *
	 * Plugins are processed **sequentially** (one at a time), while pages
	 * within each plugin are processed in **parallel** (bounded to
	 * {@link CONCURRENCY_LIMIT}). This architecture enables per-plugin
	 * progress tracking via Lanes.
	 *
	 * The analysis proceeds in two phases:
	 *
	 * 1. **`eachPage` phase** - For each plugin with `eachPage`, spawns
	 *    Worker threads via a bounded Promise pool to analyze all pages.
	 *    Progress is displayed via Lanes if provided in options.
	 *
	 * 2. **`eachUrl` phase** - For all plugins with `eachUrl`, runs
	 *    sequentially in the main thread. These are lightweight checks
	 *    that don't need DOM access.
	 *
	 * On completion, three data entries are stored in the archive:
	 * - `analysis/report` - Full {@link Report} with headers, data, and violations
	 * - `analysis/table` - The raw {@link Table} instance (serialized)
	 * - `analysis/violations` - Flat array of all {@link Violation} records
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
		}>('nitpicker-axe', path.join(os.tmpdir(), 'nitpicker/cache/table'));

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

		await this.archive.getPagesWithRefs(
			100_000,
			async (pages) => {
				const urlEmitter = new UrlEventBus();

				// Phase 1: eachPage plugins (sequentially, pages in parallel)
				for (const [pluginSeqIndex, { plugin }] of eachPagePlugins.entries()) {
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

					// Bounded Promise pool (replaces deal())
					const executing = new Set<Promise<void>>();

					for (const [pageIndex, page] of pages.entries()) {
						const task = (async () => {
							const cacheKey = `${plugin.name}:${page.url.href}`;
							const cached = await cache.load(cacheKey);
							if (cached) {
								const { pages: cachedPages, violations } = cached;
								if (cachedPages) {
									table.addData(cachedPages);
								}
								if (violations) {
									allViolations.push(...violations);
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

							const report = await runInWorker<
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
							}

							await cache.store(cacheKey, {
								pages: Object.keys(tablePages).length > 0 ? tablePages : undefined,
								violations: report?.violations,
							});

							if (report?.violations) {
								allViolations.push(...report.violations);
								pluginViolationCount += report.violations.length;
							}

							done++;
							updateProgress();
						})();
						executing.add(task);
						task.then(
							() => executing.delete(task),
							() => executing.delete(task),
						);
						if (executing.size >= CONCURRENCY_LIMIT) {
							await Promise.race(executing);
						}
					}

					await Promise.all(executing);

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

						const report = await mod.eachUrl({ url, isExternal });
						if (!report) {
							continue;
						}

						const { page: reportPage, violations } = report;

						if (reportPage) {
							table.addDataToUrl(url, reportPage);
						}

						if (violations) {
							allViolations.push(...violations);
						}
					}
				}
			},
			{
				withRefs: false,
			},
		);

		const report: Report = {
			name: 'general',
			pageData: table.toJSON(),
			violations: allViolations,
		};

		await this.archive.setData('analysis/report', report);
		await this.archive.setData('analysis/table', table);
		await this.archive.setData('analysis/violations', allViolations);
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
			this.#config = await loadPluginSettings();
		}

		return this.#config;
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
