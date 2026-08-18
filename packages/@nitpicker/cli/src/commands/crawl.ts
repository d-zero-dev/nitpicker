import type { commandDef } from './crawl-def.js';
import type { SetupLanesHandle } from '../crawl/setup-lanes.js';
import type { InferFlags } from '@d-zero/roar';
import type { Config, CrawlerError } from '@nitpicker/crawler';

import fs from 'node:fs/promises';
import path from 'node:path';

import { Lanes } from '@d-zero/dealer';
import { readList, toListWithPosition } from '@d-zero/readtext/list';
import {
	assertChromeIsInstalled,
	assertPuppeteerSharedWithBeholder,
	computeFileSha256,
	CrawlerOrchestrator,
} from '@nitpicker/crawler';

import { classifyInventoryListItems } from '../crawl/classify-inventory-list-items.js';
import { log, verbosely } from '../crawl/debug.js';
import { diff } from '../crawl/diff.js';
import { ensureViewerReadModelQuietly } from '../crawl/ensure-viewer-read-model-quietly.js';
import { eventAssignments } from '../crawl/event-assignments.js';
import { formatInvalidInventoryUrlWarning } from '../crawl/format-invalid-inventory-url-warning.js';
import { formatInventorySkipSummary } from '../crawl/format-inventory-skip-summary.js';
import { isValidUrl } from '../crawl/is-valid-url.js';
import { mapFlagsToCrawlConfig } from '../crawl/map-flags-to-crawl-config.js';
import { scanJsResourcesQuietly } from '../crawl/scan-js-resources-quietly.js';
import { createSetupLanes } from '../crawl/setup-lanes.js';
import { ExitCode } from '../exit-code.js';
import { formatLogLine } from '../format-log-line.js';

import { CrawlAggregateError } from './crawl-aggregate-error.js';

/** Parsed flag values for the `crawl` CLI command. */
type CrawlFlags = InferFlags<typeof commandDef.flags>;

type LogType = 'verbose' | 'normal' | 'silent';

/**
 * Sets up signal handlers for graceful shutdown and starts event logging.
 *
 * Registers SIGINT/SIGBREAK/SIGHUP/SIGABRT handlers that abort the
 * crawl via {@link CrawlerOrchestrator.abort}, then kill zombie Chromium
 * processes and exit. The abort signal propagates through the dealer's
 * AbortSignal mechanism so no new workers are launched.
 *
 * Signal handlers are automatically removed in a `finally` block when
 * the event assignment pipeline completes or throws.
 * @param trigger - Display label for the crawl (URL or stub file path)
 * @param orchestrator - The initialized CrawlerOrchestrator instance
 * @param config - The resolved archive configuration
 * @param logType - Output verbosity level
 * @returns A promise that resolves when the event assignment pipeline completes.
 */
async function run(
	trigger: string,
	orchestrator: CrawlerOrchestrator,
	config: Config,
	logType: LogType,
) {
	const killed = () => {
		orchestrator.abort();
		orchestrator.garbageCollect();
		process.exit();
	};
	const signals: NodeJS.Signals[] = ['SIGINT', 'SIGBREAK', 'SIGHUP', 'SIGABRT'];
	for (const signal of signals) {
		process.on(signal, killed);
	}

	const head = [
		`🐳 ${trigger} (New scraping)`,
		...Object.entries(config).map(([key, value]) => `  ${key}: ${value}`),
	];
	try {
		return await eventAssignments(orchestrator, head, logType);
	} finally {
		for (const signal of signals) {
			process.removeListener(signal, killed);
		}
	}
}

/**
 * Invokes a `CrawlerOrchestrator` static factory (`append`/`inventory`/
 * `retryFailed`/`resume`), closing `setupLanes` if the factory throws
 * before ever invoking its `initializedCallback` (issue #294 code review:
 * that callback was the only place `setupLanes.close()` ran, so a failure
 * during setup — before the callback fires — e.g. a `.bak` copy I/O error,
 * left the `Lanes` line's self-rescheduling repaint timer running forever).
 * `close()` is idempotent, so this is safe even when the callback already
 * closed it on the success path.
 * @param setupLanes - The setup-phase Lanes handle, or `null` under `--silent`.
 * @param factory - Thunk invoking the orchestrator static factory method.
 * @returns The orchestrator the factory resolved with.
 */
async function createOrchestratorClosingLanesOnFailure<T>(
	setupLanes: SetupLanesHandle | null,
	factory: () => Promise<T>,
): Promise<T> {
	try {
		return await factory();
	} catch (error) {
		setupLanes?.close();
		throw error;
	}
}

/**
 * Starts a fresh crawl session for the given URLs.
 *
 * Creates a CrawlerOrchestrator, runs the crawl, writes the archive,
 * and cleans up browser processes.
 * @param siteUrl - One or more root URLs to crawl
 * @param flags - Parsed CLI flags from the `crawl` command
 * @returns A promise that resolves with the archive file path when crawling, writing, and cleanup are complete.
 * @throws {CrawlAggregateError} When one or more errors occurred during crawling.
 */
export async function startCrawl(siteUrl: string[], flags: CrawlFlags): Promise<string> {
	const errStack: (CrawlerError | Error)[] = [];

	const isList = !!flags.list?.length;
	await using orchestrator = await CrawlerOrchestrator.crawling(
		siteUrl,
		{
			...mapFlagsToCrawlConfig(flags),
			filePath: flags.output,
			list: isList,
			// --single（単一ページモード）および --list モードでは再帰クロールを無効化
			recursive: isList || flags.single ? false : flags.recursive,
		},
		(orchestrator, config) => {
			run(
				config.baseUrl,
				orchestrator,
				config,
				flags.verbose ? 'verbose' : flags.silent ? 'silent' : 'normal',
			).catch((error) => errStack.push(error));
		},
	);

	if (!flags.skipTechnologyJsScan) {
		await scanJsResourcesQuietly(orchestrator.archive, { verbose: flags.verbose });
	}
	await ensureViewerReadModelQuietly(orchestrator.archive, { verbose: flags.verbose });
	await orchestrator.write();

	const archivePath = orchestrator.archive.filePath;

	if (errStack.length > 0) {
		const error = new CrawlAggregateError(errStack);
		// eslint-disable-next-line no-console
		console.error(`\n${error.message}`);
		throw error;
	}

	return archivePath;
}

/**
 * Resumes a previously interrupted crawl from a stub file (temporary directory).
 *
 * Restores the crawl state from the archive, applies any flag overrides,
 * and continues crawling from where the previous session left off.
 * @param stubFilePath - Path to the stub file or temporary directory to resume from
 * @param flags - Parsed CLI flags from the `crawl` command
 * @returns A promise that resolves when crawling, writing, and cleanup are complete.
 */
async function resumeCrawl(stubFilePath: string, flags: CrawlFlags) {
	const errStack: (CrawlerError | Error)[] = [];
	const absFilePath = path.isAbsolute(stubFilePath)
		? stubFilePath
		: path.resolve(process.cwd(), stubFilePath);
	const setupLanes = flags.silent ? null : createSetupLanes(!!flags.verbose);

	await using orchestrator = await createOrchestratorClosingLanesOnFailure(
		setupLanes,
		() =>
			CrawlerOrchestrator.resume(
				absFilePath,
				{
					...mapFlagsToCrawlConfig(flags),
					list: false,
				},
				(orchestrator, config) => {
					setupLanes?.close();
					run(
						stubFilePath,
						orchestrator,
						config,
						flags.verbose ? 'verbose' : flags.silent ? 'silent' : 'normal',
					).catch((error) => errStack.push(error));
				},
				setupLanes?.setupProgress,
			),
	);

	if (!flags.skipTechnologyJsScan) {
		await scanJsResourcesQuietly(orchestrator.archive, { verbose: flags.verbose });
	}
	await ensureViewerReadModelQuietly(orchestrator.archive, { verbose: flags.verbose });
	await orchestrator.write();

	if (errStack.length > 0) {
		const error = new CrawlAggregateError(errStack);
		// eslint-disable-next-line no-console
		console.error(`\n${error.message}`);
		throw error;
	}
}

/**
 * Append a fresh crawl to an existing `.nitpicker` archive.
 *
 * Opens the archive identified by the positional argument, registers the
 * `--append` URLs as additional recursive roots, re-scrapes any
 * previously-external pages whose URL now falls under the expanded scope,
 * and writes the result back to the same file. A `<archive>.bak` is taken
 * before any DB mutation; on success it is removed, on failure it is
 * restored.
 * @param archivePath - Path to the existing `.nitpicker` archive.
 * @param newUrls - URLs from one or more `--append` flags. Must be non-empty.
 * @param flags - Parsed CLI flags from the `crawl` command.
 */
async function appendCrawl(archivePath: string, newUrls: string[], flags: CrawlFlags) {
	validateUrls(newUrls);
	const errStack: (CrawlerError | Error)[] = [];
	const setupLanes = flags.silent ? null : createSetupLanes(!!flags.verbose);

	await using orchestrator = await createOrchestratorClosingLanesOnFailure(
		setupLanes,
		() =>
			CrawlerOrchestrator.append(
				archivePath,
				newUrls,
				{
					...mapFlagsToCrawlConfig(flags),
					list: false,
				},
				(orchestrator, config) => {
					setupLanes?.close();
					run(
						`${archivePath} (append: ${newUrls.join(', ')})`,
						orchestrator,
						config,
						flags.verbose ? 'verbose' : flags.silent ? 'silent' : 'normal',
					).catch((error) => errStack.push(error));
				},
				setupLanes?.setupProgress,
			),
	);

	if (!flags.skipTechnologyJsScan) {
		await scanJsResourcesQuietly(orchestrator.archive, { verbose: flags.verbose });
	}
	await ensureViewerReadModelQuietly(orchestrator.archive, { verbose: flags.verbose });
	await orchestrator.write();

	if (errStack.length > 0) {
		const error = new CrawlAggregateError(errStack);
		// eslint-disable-next-line no-console
		console.error(`\n${error.message}`);
		throw error;
	}
}

/**
 * Inventory-mode dispatch: read the URL list file, hand it to
 * {@link CrawlerOrchestrator.inventory}, and surface the result through
 * the same `run` progress reporter as the other crawl modes.
 *
 * The list file is read exactly once, as raw bytes — the same buffer feeds
 * the content-hash (`computeFileSha256`), the parsed URL list, and the copy
 * archived by the orchestrator, so the hash naming the archived copy always
 * matches what was actually parsed even if the file changes on disk between
 * calls. Lines are split by `toListWithPosition` (`@d-zero/readtext/list`),
 * which strips blank lines and `#` comments — same conventions as
 * `--list-file` — while keeping each surviving line's source position.
 *
 * Unlike every other URL-list entry point in this command (positional args,
 * `--list`, `--list-file`), an unparseable line here does not abort the
 * run: source lists come from machine-generated intermediates (a doc-root
 * `ls`, a spreadsheet export) where a handful of malformed lines is the
 * norm, and discarding 1,222 good URLs over 12 bad ones defeats the "find
 * orphan pages" purpose of `--inventory` (issue #99). Each invalid line is
 * warned individually (with its line:column, so the operator can find and
 * fix it) and a summary is printed once at the end; if every line is
 * invalid, that's a real "wrong file" input error and still throws.
 * @param archivePath - Path to the existing `.nitpicker` archive (positional).
 * @param listFile - Path to the URL list file passed via `--inventory`.
 * @param flags - Parsed CLI flags from the `crawl` command.
 */
async function inventoryCrawl(archivePath: string, listFile: string, flags: CrawlFlags) {
	const resolvedListFile = path.resolve(process.cwd(), listFile);
	const bytes = await fs.readFile(resolvedListFile);
	const items = toListWithPosition(bytes.toString('utf8'));
	if (items.length === 0) {
		throw new Error(`No URLs found in inventory file: ${listFile}`);
	}

	const { valid, invalid } = classifyInventoryListItems(items);
	if (invalid.length > 0) {
		for (const item of invalid) {
			// eslint-disable-next-line no-console -- operator-facing warning, must be visible regardless of DEBUG filters or --silent
			console.warn(formatInvalidInventoryUrlWarning(listFile, item));
		}
		// eslint-disable-next-line no-console -- see above
		console.warn(formatInventorySkipSummary(invalid.length, items.length));
	}
	if (valid.length === 0) {
		throw new Error(
			`All ${invalid.length} line(s) in inventory file failed URL validation: ${listFile}`,
		);
	}

	const sha256 = computeFileSha256(bytes);
	const errStack: (CrawlerError | Error)[] = [];
	const setupLanes = flags.silent ? null : createSetupLanes(!!flags.verbose);

	await using orchestrator = await createOrchestratorClosingLanesOnFailure(
		setupLanes,
		() =>
			CrawlerOrchestrator.inventory(
				archivePath,
				valid,
				{
					...mapFlagsToCrawlConfig(flags),
					list: false,
				},
				(orchestrator, config) => {
					setupLanes?.close();
					run(
						`${archivePath} (inventory: ${listFile})`,
						orchestrator,
						config,
						flags.verbose ? 'verbose' : flags.silent ? 'silent' : 'normal',
					).catch((error) => errStack.push(error));
				},
				{ sha256, bytes, invalidLineCount: invalid.length },
				setupLanes?.setupProgress,
			),
	);

	if (!flags.skipTechnologyJsScan) {
		await scanJsResourcesQuietly(orchestrator.archive, { verbose: flags.verbose });
	}
	await ensureViewerReadModelQuietly(orchestrator.archive, { verbose: flags.verbose });
	await orchestrator.write();

	if (errStack.length > 0) {
		const error = new CrawlAggregateError(errStack);
		// eslint-disable-next-line no-console
		console.error(`\n${error.message}`);
		throw error;
	}
}

/**
 * Re-fetch failed pages in an existing `.nitpicker` archive and re-crawl.
 *
 * Opens the archive at the positional argument, resets every page whose
 * previous attempt failed (missing status / content type, or a 5xx status)
 * back to pending, and resumes crawling. Newly-discovered URLs are followed
 * unless `--no-recursive` was given. The archived crawl configuration
 * (scopes, excludes, keywords, user agent, …) is reused unless explicitly
 * overridden. A `<archive>.bak` is taken before any DB mutation; on success it
 * is removed, on failure it is restored.
 * @param archivePath - Path to the existing `.nitpicker` archive.
 * @param flags - Parsed CLI flags from the `crawl` command.
 */
async function retryFailedCrawl(archivePath: string, flags: CrawlFlags) {
	const errStack: (CrawlerError | Error)[] = [];
	const setupLanes = flags.silent ? null : createSetupLanes(!!flags.verbose);

	await using orchestrator = await createOrchestratorClosingLanesOnFailure(
		setupLanes,
		() =>
			CrawlerOrchestrator.retryFailed(
				archivePath,
				{
					...mapFlagsToCrawlConfig(flags),
					list: false,
				},
				(orchestrator, config) => {
					setupLanes?.close();
					run(
						`${archivePath} (retry-failed)`,
						orchestrator,
						config,
						flags.verbose ? 'verbose' : flags.silent ? 'silent' : 'normal',
					).catch((error) => errStack.push(error));
				},
				setupLanes?.setupProgress,
			),
	);

	if (!flags.skipTechnologyJsScan) {
		await scanJsResourcesQuietly(orchestrator.archive, { verbose: flags.verbose });
	}
	await ensureViewerReadModelQuietly(orchestrator.archive, { verbose: flags.verbose });
	await orchestrator.write();

	if (errStack.length > 0) {
		const error = new CrawlAggregateError(errStack);
		// eslint-disable-next-line no-console
		console.error(`\n${error.message}`);
		throw error;
	}
}

/**
 * Validates that all URLs in the list are parseable by the URL constructor.
 * @param urls - Array of URL strings to validate
 * @throws {Error} If any URL is invalid
 */
function validateUrls(urls: readonly string[]) {
	for (const url of urls) {
		if (!isValidUrl(url)) {
			throw new Error(
				`Invalid URL: "${url}". Please provide a valid URL (e.g., https://example.com)`,
			);
		}
	}
}

/**
 * Main entry point for the `crawl` CLI command.
 *
 * Dispatches to one of the following modes based on the flags
 * (mutually-exclusive flag combinations are rejected up front):
 * 1. `--diff` mode: Compares two archive files and outputs URL lists
 * 2. `--resume` mode: Resumes a previously interrupted crawl
 * 3. `--inventory` mode: Imports URLs from a list file that an existing archive does not yet track
 * 4. `--append` mode: Adds new recursive roots to an existing archive
 * 5. `--retry-failed` mode: Re-fetches failed pages in an existing archive
 * 6. `--list-file` / `--list` mode: Crawls a pre-defined URL list (non-recursive)
 * 7. Default mode: Crawls from one or more root URLs
 *
 * Every mode except `--diff` launches a browser, so
 * {@link assertChromeIsInstalled} runs once up front and fails fast if
 * Chrome is missing, rather than letting it surface per-page.
 * {@link assertPuppeteerSharedWithBeholder} runs alongside it, catching a
 * `puppeteer`/`@d-zero/beholder` version drift before it can surface as an
 * opaque `Page` type mismatch mid-crawl.
 * @param args - Positional arguments (typically one or two URLs/file paths)
 * @param flags - Parsed CLI flags from the `crawl` command
 * @returns A promise that resolves when the dispatched mode completes.
 */
export async function crawl(args: string[], flags: CrawlFlags) {
	if (flags.verbose && !flags.silent) {
		verbosely();
	}

	log('Options: %O', flags);

	const hasAppendFlag = !!flags.append && flags.append.length > 0;
	const hasInventoryFlag = !!flags.inventory;

	if (flags.diff) {
		if (hasAppendFlag) {
			throw new Error('--diff cannot be combined with --append.');
		}
		if (flags.retryFailed) {
			throw new Error('--diff cannot be combined with --retry-failed.');
		}
		if (hasInventoryFlag) {
			throw new Error('--diff cannot be combined with --inventory.');
		}
		if (args.length !== 2) {
			throw new Error('--diff takes exactly two file paths to compare');
		}
		await diff(args[0]!, args[1]!, { verbose: flags.verbose, silent: flags.silent });
		return;
	}

	const hasListFlag = !!flags.list && flags.list.length > 0;

	if (flags.single && (hasListFlag || flags.listFile)) {
		// eslint-disable-next-line no-console
		console.warn('Warning: --single is ignored when --list or --list-file is specified.');
	}

	if (flags.single && args.length > 1) {
		throw new Error('--single cannot be combined with multiple positional URLs');
	}

	try {
		// Every mode below launches a browser per URL; failing this once,
		// up front, turns a missing Chrome into an immediate fatal error
		// instead of a per-page scrape error buried in a "completed with
		// N error(s)" summary (see `assertChromeIsInstalled`'s JSDoc).
		// A dedicated, short-lived `Lanes` line covers just this check
		// (issue #294): it's the very first thing the process does, before
		// any archive/setup display exists, so without it a slow Chrome
		// lookup looks like the process hasn't started at all.
		{
			using checkingLanes = flags.silent
				? null
				: new Lanes({ verbose: !!flags.verbose, indent: '  ', stream: process.stderr });
			checkingLanes?.update(
				0,
				formatLogLine(!!flags.verbose, '%braille% Checking browser%dots%'),
			);
			await assertChromeIsInstalled();
			assertPuppeteerSharedWithBeholder();
		}

		if (flags.resume) {
			if (flags.output) {
				throw new Error(
					'--output flag is not supported with --resume. The archive path is determined by the stub file.',
				);
			}
			if (hasAppendFlag) {
				throw new Error(
					'--resume and --append cannot be used together. Pick the existing-archive mode that fits your task.',
				);
			}
			if (flags.retryFailed) {
				throw new Error(
					'--resume and --retry-failed cannot be used together. Pick the existing-archive mode that fits your task.',
				);
			}
			if (hasInventoryFlag) {
				throw new Error(
					'--resume and --inventory cannot be used together. Pick the existing-archive mode that fits your task.',
				);
			}
			await resumeCrawl(flags.resume, flags);
			return;
		}

		if (hasInventoryFlag) {
			if (hasAppendFlag) {
				throw new Error(
					'--inventory and --append cannot be used together. Pick the existing-archive mode that fits your task.',
				);
			}
			if (flags.retryFailed) {
				throw new Error(
					'--inventory and --retry-failed cannot be used together. Pick the existing-archive mode that fits your task.',
				);
			}
			if (flags.output) {
				throw new Error(
					'--output flag is not supported with --inventory. The archive path is the positional argument being inventoried.',
				);
			}
			if (flags.listFile) {
				throw new Error('--inventory cannot be combined with --list-file.');
			}
			if (hasListFlag) {
				throw new Error('--inventory cannot be combined with --list.');
			}
			if (flags.single) {
				throw new Error('--inventory cannot be combined with --single.');
			}
			if (args.length === 0) {
				throw new Error(
					'--inventory requires the archive path as the positional argument (usage: crawl <archive> --inventory <urls.txt>).',
				);
			}
			if (args.length > 1) {
				throw new Error(
					'--inventory takes exactly one positional argument (the archive path).',
				);
			}
			await inventoryCrawl(args[0]!, flags.inventory!, flags);
			return;
		}

		if (hasAppendFlag) {
			if (flags.retryFailed) {
				throw new Error(
					'--append and --retry-failed cannot be used together. Pick the existing-archive mode that fits your task.',
				);
			}
			if (flags.output) {
				throw new Error(
					'--output flag is not supported with --append. The archive path is the positional argument being appended.',
				);
			}
			if (flags.listFile) {
				throw new Error('--append cannot be combined with --list-file.');
			}
			if (hasListFlag) {
				throw new Error('--append cannot be combined with --list.');
			}
			if (flags.single) {
				throw new Error('--append cannot be combined with --single.');
			}
			if (args.length === 0) {
				throw new Error(
					'--append requires the archive path as the positional argument (usage: crawl <archive> --append <URL>).',
				);
			}
			if (args.length > 1) {
				throw new Error(
					'--append takes exactly one positional argument (the archive path). Extra positionals were given — append URLs must follow `--append`, not the archive.',
				);
			}
			await appendCrawl(args[0]!, flags.append, flags);
			return;
		}

		if (flags.retryFailed) {
			if (flags.output) {
				throw new Error(
					'--output flag is not supported with --retry-failed. The archive path is the positional argument being retried.',
				);
			}
			if (flags.listFile) {
				throw new Error('--retry-failed cannot be combined with --list-file.');
			}
			if (hasListFlag) {
				throw new Error('--retry-failed cannot be combined with --list.');
			}
			if (flags.single) {
				throw new Error('--retry-failed cannot be combined with --single.');
			}
			if (args.length === 0) {
				throw new Error(
					'--retry-failed requires the archive path as the positional argument (usage: crawl <archive> --retry-failed).',
				);
			}
			if (args.length > 1) {
				throw new Error(
					'--retry-failed takes exactly one positional argument (the archive path).',
				);
			}
			await retryFailedCrawl(args[0]!, flags);
			return;
		}

		if (flags.listFile) {
			const list = await readList(path.resolve(process.cwd(), flags.listFile));
			if (list.length === 0) {
				throw new Error(`No URLs found in list file: ${flags.listFile}`);
			}
			validateUrls(list);
			flags.list = list;
			await startCrawl(list, flags);
			return;
		}

		if (hasListFlag) {
			const pageList = [...flags.list, ...args];
			validateUrls(pageList);
			await startCrawl(pageList, flags);
			return;
		}

		if (args.length > 0) {
			validateUrls(args);
			await startCrawl(args, flags);
			return;
		}
	} catch (error) {
		if (error instanceof CrawlAggregateError) {
			const exitCode =
				error.hasOnlyExternalErrors && !flags.strict ? ExitCode.Warning : ExitCode.Fatal;
			process.exit(exitCode);
		}
		throw error;
	}
}
