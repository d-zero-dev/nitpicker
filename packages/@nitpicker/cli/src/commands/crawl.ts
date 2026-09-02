import type { commandDef } from './crawl-def.js';
import type { CrawlDisplayHandle } from '../crawl/attach-crawl-display.js';
import type { SetupTaskListHandle } from '../crawl/create-setup-task-list.js';
import type { InferFlags } from '@d-zero/roar';
import type { Config, CrawlerError } from '@nitpicker/crawler';

import path from 'node:path';

import { TaskList, TaskListStepError } from '@d-zero/dealer';
import { readList } from '@d-zero/readtext/list';
import {
	APPEND_SETUP_PHASES,
	assertChromeIsInstalled,
	assertPuppeteerSharedWithBeholder,
	computeFileSha256,
	CrawlerOrchestrator,
	INVENTORY_SETUP_PHASES,
	RECRAWL_SETUP_PHASES,
	RESUME_SETUP_PHASES,
	RETRY_FAILED_SETUP_PHASES,
} from '@nitpicker/crawler';

import { attachCrawlDisplay } from '../crawl/attach-crawl-display.js';
import { createSetupTaskList } from '../crawl/create-setup-task-list.js';
import { log, verbosely } from '../crawl/debug.js';
import { diff } from '../crawl/diff.js';
import { formatInvalidInventoryUrlWarning } from '../crawl/format-invalid-inventory-url-warning.js';
import { formatInvalidRecrawlUrlWarning } from '../crawl/format-invalid-recrawl-url-warning.js';
import { formatInventorySkipSummary } from '../crawl/format-inventory-skip-summary.js';
import { formatRecrawlSkipSummary } from '../crawl/format-recrawl-skip-summary.js';
import { isValidUrl } from '../crawl/is-valid-url.js';
import { mapFlagsToCrawlConfig } from '../crawl/map-flags-to-crawl-config.js';
import { runPostCrawlTaskList } from '../crawl/run-post-crawl-task-list.js';
import { ExitCode } from '../exit-code.js';
import { readUrlListFile } from '../read-url-list-file.js';

import { CrawlAggregateError } from './crawl-aggregate-error.js';

/** Parsed flag values for the `crawl` CLI command. */
type CrawlFlags = InferFlags<typeof commandDef.flags>;

type LogType = 'verbose' | 'normal' | 'silent';

/**
 * Derives the display verbosity level shared by every crawl mode's
 * `attachCrawlDisplay` call from the raw `--verbose`/`--silent` flags —
 * `--verbose` wins if both are somehow set. A single source of truth so the
 * five mode functions can't drift on precedence.
 * @param flags - Parsed CLI flags from the `crawl` command.
 * @returns The resolved {@link LogType}.
 */
function deriveLogType(flags: CrawlFlags): LogType {
	return flags.verbose ? 'verbose' : flags.silent ? 'silent' : 'normal';
}

/**
 * Registers SIGINT/SIGBREAK/SIGHUP/SIGABRT handlers that abort the crawl via
 * {@link CrawlerOrchestrator.abort}, then kill zombie Chromium processes and
 * exit. Call from `initializedCallback` — the earliest point the CLI has
 * both the orchestrator instance and control before crawling actually
 * starts — and call the returned cleanup once the post-crawl task list
 * finishes. The span must cover the crawl body and the post-crawl task list
 * alike (issue #294): both can run for minutes, and `orchestrator` already
 * holds browser resources by the time this registers, so Ctrl-C anywhere in
 * that window needs `orchestrator.abort()`, not Node's default handling.
 * @param orchestrator - The initialized CrawlerOrchestrator instance.
 * @returns A cleanup function that removes the handlers. Safe to call at most once.
 */
function registerCrawlSignalHandlers(orchestrator: CrawlerOrchestrator): () => void {
	const killed = () => {
		orchestrator.abort();
		orchestrator.garbageCollect();
		process.exit();
	};
	const signals: NodeJS.Signals[] = ['SIGINT', 'SIGBREAK', 'SIGHUP', 'SIGABRT'];
	for (const signal of signals) {
		process.on(signal, killed);
	}
	return () => {
		for (const signal of signals) {
			process.removeListener(signal, killed);
		}
	};
}

/**
 * Builds the crawl-start header lines `attachCrawlDisplay` prints to stderr.
 * @param trigger - Display label for the crawl (URL or stub file path).
 * @param config - The resolved archive configuration.
 * @returns Header lines, first entry bold and the rest dimmed.
 */
function buildCrawlHeader(trigger: string, config: Config): string[] {
	return [
		`🐳 ${trigger} (New scraping)`,
		...Object.entries(config).map(([key, value]) => `  ${key}: ${value}`),
	];
}

/**
 * Invokes a `CrawlerOrchestrator` static factory (`append`/`inventory`/
 * `recrawl`/`retryFailed`/`resume`), failing `setupTaskList` if the factory throws
 * before ever invoking its `initializedCallback` (issue #294 code review,
 * carried over from the pre-`TaskList` `setupLanes.close()`-on-failure
 * behavior: that call was the only place the setup display was ever
 * released, so a failure during setup — before the callback fires — e.g. a
 * `.bak` copy I/O error, left it open forever). `fail()` is idempotent, so
 * this is safe even when `initializedCallback` already called `finish()` on
 * the success path.
 *
 * Also releases `crawlLifecycle`'s signal handlers and fails its crawl
 * display's task list on failure (issue #294): `initializedCallback` may
 * have already registered/attached them (crawling itself starts right after
 * it returns), so a later failure inside the factory — `crawling()` or
 * `#setUrlOrder()` throwing — must not leak `process`-level
 * SIGINT/SIGBREAK/SIGHUP/SIGABRT listeners referencing an orchestrator
 * that's about to be disposed, nor leave the crawl display's `TaskList` row
 * `pending` forever (it settles the active row `error` instead, matching
 * `setupTaskList.fail()`'s own contract). Both are no-ops when
 * `initializedCallback` never ran.
 * @param setupTaskList - The setup-phase task list handle, or `null` under `--silent`.
 * @param crawlLifecycle - The handles `createCrawlInitializedCallback` fills in.
 * @param factory - Thunk invoking the orchestrator static factory method.
 * @returns The orchestrator the factory resolved with.
 */
async function createOrchestratorFailingSetupOnError<T>(
	setupTaskList: SetupTaskListHandle | null,
	crawlLifecycle: CrawlLifecycle,
	factory: () => Promise<T>,
): Promise<T> {
	try {
		return await factory();
	} catch (error) {
		setupTaskList?.fail(error);
		await setupTaskList?.taskListDone.catch(() => {});
		crawlLifecycle.display?.fail(error);
		await crawlLifecycle.display?.taskListDone.catch(() => {});
		crawlLifecycle.unregisterSignalHandlers?.();
		throw error;
	}
}

/** Mutable handles threaded through one crawl mode's `initializedCallback` and cleanup. */
interface CrawlLifecycle {
	display: CrawlDisplayHandle | null;
	unregisterSignalHandlers: (() => void) | null;
}

/**
 * Creates a fresh {@link CrawlLifecycle}. A plain object, not two `let`s:
 * TypeScript's narrowing otherwise treats each field as permanently `null`
 * past this point, since the only reassignment is inside
 * `initializedCallback`'s nested closure.
 * @returns An empty {@link CrawlLifecycle}.
 */
function createCrawlLifecycle(): CrawlLifecycle {
	return { display: null, unregisterSignalHandlers: null };
}

/**
 * Builds the `initializedCallback` every crawl mode passes to its
 * `CrawlerOrchestrator` factory (`crawling`/`resume`/`append`/`inventory`/
 * `recrawl`/`retryFailed`) — shared so the six modes can't drift on ordering.
 *
 * Registers the crawl-body signal handlers *before* touching `setupTaskList`
 * (issue #294: registering them only after `finish()`/`taskListDone`
 * resolved left a window — at least one microtask turn while dealer tears
 * down the setup `Lanes` — where Ctrl-C fell through to Node's default
 * handling instead of `orchestrator.abort()`, since `orchestrator` already
 * exists and may already hold browser resources). `setupTaskList` is `null`
 * for `startCrawl` (no setup phase), so `finish()`/`taskListDone` are no-ops
 * there.
 * @param setupTaskList - The setup-phase task list handle, or `null` for modes with no setup phase (`startCrawl`).
 * @param crawlLifecycle - Mutable handles this callback fills in.
 * @param logType - Verbosity level passed through to `attachCrawlDisplay`.
 * @param errStack - Crawl-time errors are pushed here as they arrive.
 * @param trigger - Display label for the crawl (URL or stub file path), or a
 *   function of the resolved config for modes where the trigger isn't known
 *   until then (`startCrawl`'s fresh-crawl `config.baseUrl`).
 * @returns The `initializedCallback` to pass to the orchestrator factory.
 */
function createCrawlInitializedCallback(
	setupTaskList: SetupTaskListHandle | null,
	crawlLifecycle: CrawlLifecycle,
	logType: LogType,
	errStack: (CrawlerError | Error)[],
	trigger: string | ((config: Config) => string),
): (orchestrator: CrawlerOrchestrator, config: Config) => Promise<void> {
	return async (orchestrator, config) => {
		crawlLifecycle.unregisterSignalHandlers = registerCrawlSignalHandlers(orchestrator);
		setupTaskList?.finish();
		await setupTaskList?.taskListDone;
		const triggerLabel = typeof trigger === 'function' ? trigger(config) : trigger;
		crawlLifecycle.display = attachCrawlDisplay({
			orchestrator,
			initialLog: buildCrawlHeader(triggerLabel, config),
			logType,
			errStack,
		});
	};
}

/**
 * Unwraps a `TaskListStepError` (thrown by `runPostCrawlTaskList`, or by the
 * pre-crawl `TaskList.pipe('Checking browser', ...)` check, when the
 * underlying step fails) down to the original cause, so the operator sees
 * the real error (`Error: disk full`) instead of dealer's step-wrapper text
 * (`Error: Step "Write archive" (index: 2) failed: disk full`). Passes any
 * other error through unchanged.
 * @param error - The error a `TaskList.run()` call rejected with.
 * @returns The unwrapped cause, or `error` itself if it isn't a `TaskListStepError`.
 */
function unwrapTaskListStepError(error: unknown): unknown {
	return error instanceof TaskListStepError ? error.cause : error;
}

/**
 * Coerces an unwrapped, potentially non-`Error` thrown value into an
 * `Error` so it can join {@link CrawlAggregateError}'s `(CrawlerError |
 * Error)[]` list alongside genuine crawl-time errors.
 * @param value - The value to coerce.
 * @returns `value` unchanged if it's already an `Error`, otherwise a new
 *   `Error` wrapping its string form.
 */
function toError(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}

/**
 * Runs the post-crawl task list and tears down the per-mode lifecycle
 * shared by every crawl mode: finishes the crawl display's task list, runs
 * `runPostCrawlTaskList`, releases the signal handlers, and throws a single
 * {@link CrawlAggregateError} covering both the crawl body's own errors
 * (`errStack`, collected by `attachCrawlDisplay`) and a post-crawl task-list
 * failure (unwrapped via {@link unwrapTaskListStepError}) if either
 * occurred — folding the latter into `errStack` rather than throwing it
 * separately, so a `runPostCrawlTaskList` failure (e.g. `orchestrator.write()`
 * running out of disk) can never silently swallow crawl-time page errors
 * that were already sitting in `errStack` (issue #294: the two used to be
 * reported through separate, mutually-exclusive paths).
 * @param orchestrator - The orchestrator returned by the completed crawl.
 * @param crawlLifecycle - The handles `createCrawlInitializedCallback` filled in.
 * @param flags - Parsed CLI flags from the `crawl` command.
 * @param errStack - Crawl-time errors collected by `attachCrawlDisplay`.
 * @throws {CrawlAggregateError} If the crawl body and/or the post-crawl task
 *   list produced any errors.
 */
async function finishCrawlMode(
	orchestrator: CrawlerOrchestrator,
	crawlLifecycle: CrawlLifecycle,
	flags: CrawlFlags,
	errStack: (CrawlerError | Error)[],
): Promise<void> {
	crawlLifecycle.display?.finish();
	await crawlLifecycle.display?.taskListDone.catch(() => {});

	try {
		await runPostCrawlTaskList(orchestrator, {
			verbose: !!flags.verbose,
			silent: !!flags.silent,
			skipTechnologyJsScan: !!flags.skipTechnologyJsScan,
		});
	} catch (error) {
		errStack.push(toError(unwrapTaskListStepError(error)));
	} finally {
		crawlLifecycle.unregisterSignalHandlers?.();
	}

	if (errStack.length > 0) {
		const error = new CrawlAggregateError(errStack);
		// eslint-disable-next-line no-console
		console.error(`\n${error.message}`);
		throw error;
	}
}

/**
 * Runs the pre-crawl Chrome/puppeteer sanity check every mode needs before
 * launching a browser (see {@link crawl}'s JSDoc for why it runs up front).
 * Shared by both `--silent` and normal dispatch so a future third assertion
 * can't be added to one branch and forgotten in the other.
 */
async function assertBrowserIsUsable(): Promise<void> {
	await assertChromeIsInstalled();
	assertPuppeteerSharedWithBeholder();
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
	const logType: LogType = deriveLogType(flags);
	const crawlLifecycle = createCrawlLifecycle();

	const isList = !!flags.list?.length;
	await using orchestrator = await createOrchestratorFailingSetupOnError(
		null,
		crawlLifecycle,
		() =>
			CrawlerOrchestrator.crawling(
				siteUrl,
				{
					...mapFlagsToCrawlConfig(flags),
					filePath: flags.output,
					list: isList,
					// --single（単一ページモード）および --list モードでは再帰クロールを無効化
					recursive: isList || flags.single ? false : flags.recursive,
				},
				createCrawlInitializedCallback(
					null,
					crawlLifecycle,
					logType,
					errStack,
					(config) => config.baseUrl,
				),
			),
	);

	await finishCrawlMode(orchestrator, crawlLifecycle, flags, errStack);

	return orchestrator.archive.filePath;
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
	const logType: LogType = deriveLogType(flags);
	const absFilePath = path.isAbsolute(stubFilePath)
		? stubFilePath
		: path.resolve(process.cwd(), stubFilePath);
	const setupTaskList = flags.silent
		? null
		: createSetupTaskList(RESUME_SETUP_PHASES, { verbose: !!flags.verbose });
	const crawlLifecycle = createCrawlLifecycle();

	await using orchestrator = await createOrchestratorFailingSetupOnError(
		setupTaskList,
		crawlLifecycle,
		() =>
			CrawlerOrchestrator.resume(
				absFilePath,
				{
					...mapFlagsToCrawlConfig(flags),
					list: false,
				},
				createCrawlInitializedCallback(
					setupTaskList,
					crawlLifecycle,
					logType,
					errStack,
					stubFilePath,
				),
				setupTaskList?.setupProgress,
			),
	);

	await finishCrawlMode(orchestrator, crawlLifecycle, flags, errStack);
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
	const logType: LogType = deriveLogType(flags);
	const setupTaskList = flags.silent
		? null
		: createSetupTaskList(APPEND_SETUP_PHASES, { verbose: !!flags.verbose });
	const crawlLifecycle = createCrawlLifecycle();

	await using orchestrator = await createOrchestratorFailingSetupOnError(
		setupTaskList,
		crawlLifecycle,
		() =>
			CrawlerOrchestrator.append(
				archivePath,
				newUrls,
				{
					...mapFlagsToCrawlConfig(flags),
					list: false,
				},
				createCrawlInitializedCallback(
					setupTaskList,
					crawlLifecycle,
					logType,
					errStack,
					`${archivePath} (append: ${newUrls.join(', ')})`,
				),
				setupTaskList?.setupProgress,
			),
	);

	await finishCrawlMode(orchestrator, crawlLifecycle, flags, errStack);
}

/**
 * Inventory-mode dispatch: read the URL list file, hand it to
 * {@link CrawlerOrchestrator.inventory}, and surface the result through
 * the same `attachCrawlDisplay` progress reporter as the other crawl modes.
 *
 * The list file is read exactly once, via {@link readUrlListFile} — the same
 * bytes feed the content-hash (`computeFileSha256`), the parsed URL list, and
 * the copy archived by the orchestrator, so the hash naming the archived copy
 * always matches what was actually parsed even if the file changes on disk
 * between calls. Blank lines and `#` comments are stripped — same
 * conventions as `--list-file` — while each surviving line's source position
 * is kept for the invalid-line warnings below.
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
	const { urls, invalid, bytes } = await readUrlListFile(resolvedListFile);
	if (urls.length === 0 && invalid.length === 0) {
		throw new Error(`No URLs found in inventory file: ${listFile}`);
	}

	if (invalid.length > 0) {
		for (const item of invalid) {
			// eslint-disable-next-line no-console -- operator-facing warning, must be visible regardless of DEBUG filters or --silent
			console.warn(formatInvalidInventoryUrlWarning(listFile, item));
		}
		// eslint-disable-next-line no-console -- see above
		console.warn(
			formatInventorySkipSummary(invalid.length, urls.length + invalid.length),
		);
	}
	if (urls.length === 0) {
		throw new Error(
			`All ${invalid.length} line(s) in inventory file failed URL validation: ${listFile}`,
		);
	}

	const sha256 = computeFileSha256(bytes);
	const errStack: (CrawlerError | Error)[] = [];
	const logType: LogType = deriveLogType(flags);
	const setupTaskList = flags.silent
		? null
		: createSetupTaskList(INVENTORY_SETUP_PHASES, { verbose: !!flags.verbose });
	const crawlLifecycle = createCrawlLifecycle();

	await using orchestrator = await createOrchestratorFailingSetupOnError(
		setupTaskList,
		crawlLifecycle,
		() =>
			CrawlerOrchestrator.inventory(
				archivePath,
				urls,
				{
					...mapFlagsToCrawlConfig(flags),
					list: false,
				},
				createCrawlInitializedCallback(
					setupTaskList,
					crawlLifecycle,
					logType,
					errStack,
					`${archivePath} (inventory: ${listFile})`,
				),
				{ sha256, bytes, invalidLineCount: invalid.length },
				setupTaskList?.setupProgress,
			),
	);

	await finishCrawlMode(orchestrator, crawlLifecycle, flags, errStack);
}

/**
 * Recrawl-mode dispatch: read the URL list file, hand it to
 * {@link CrawlerOrchestrator.recrawl}, and surface the result through the
 * same `attachCrawlDisplay` progress reporter as the other crawl modes.
 *
 * Mirrors {@link inventoryCrawl}'s file-reading contract exactly (same
 * `readUrlListFile` helper, same warn-and-skip handling of invalid lines —
 * see that function's JSDoc for the rationale), differing only in which
 * formatter functions and orchestrator method it calls.
 * @param archivePath - Path to the existing `.nitpicker` archive (positional).
 * @param listFile - Path to the URL list file passed via `--recrawl`.
 * @param flags - Parsed CLI flags from the `crawl` command.
 */
async function recrawlCrawl(archivePath: string, listFile: string, flags: CrawlFlags) {
	const resolvedListFile = path.resolve(process.cwd(), listFile);
	const { urls, invalid, bytes } = await readUrlListFile(resolvedListFile);
	if (urls.length === 0 && invalid.length === 0) {
		throw new Error(`No URLs found in recrawl file: ${listFile}`);
	}

	if (invalid.length > 0) {
		for (const item of invalid) {
			// eslint-disable-next-line no-console -- operator-facing warning, must be visible regardless of DEBUG filters or --silent
			console.warn(formatInvalidRecrawlUrlWarning(listFile, item));
		}
		// eslint-disable-next-line no-console -- see above
		console.warn(formatRecrawlSkipSummary(invalid.length, urls.length + invalid.length));
	}
	if (urls.length === 0) {
		throw new Error(
			`All ${invalid.length} line(s) in recrawl file failed URL validation: ${listFile}`,
		);
	}

	const sha256 = computeFileSha256(bytes);
	const errStack: (CrawlerError | Error)[] = [];
	const logType: LogType = deriveLogType(flags);
	const setupTaskList = flags.silent
		? null
		: createSetupTaskList(RECRAWL_SETUP_PHASES, { verbose: !!flags.verbose });
	const crawlLifecycle = createCrawlLifecycle();

	await using orchestrator = await createOrchestratorFailingSetupOnError(
		setupTaskList,
		crawlLifecycle,
		() =>
			CrawlerOrchestrator.recrawl(
				archivePath,
				urls,
				{
					...mapFlagsToCrawlConfig(flags),
					list: false,
				},
				createCrawlInitializedCallback(
					setupTaskList,
					crawlLifecycle,
					logType,
					errStack,
					`${archivePath} (recrawl: ${listFile})`,
				),
				{ sha256, bytes, invalidLineCount: invalid.length },
				setupTaskList?.setupProgress,
			),
	);

	await finishCrawlMode(orchestrator, crawlLifecycle, flags, errStack);
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
	const logType: LogType = deriveLogType(flags);
	const setupTaskList = flags.silent
		? null
		: createSetupTaskList(RETRY_FAILED_SETUP_PHASES, { verbose: !!flags.verbose });
	const crawlLifecycle = createCrawlLifecycle();

	await using orchestrator = await createOrchestratorFailingSetupOnError(
		setupTaskList,
		crawlLifecycle,
		() =>
			CrawlerOrchestrator.retryFailed(
				archivePath,
				{
					...mapFlagsToCrawlConfig(flags),
					list: false,
				},
				createCrawlInitializedCallback(
					setupTaskList,
					crawlLifecycle,
					logType,
					errStack,
					`${archivePath} (retry-failed)`,
				),
				setupTaskList?.setupProgress,
			),
	);

	await finishCrawlMode(orchestrator, crawlLifecycle, flags, errStack);
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
 * 4. `--recrawl` mode: Re-fetches URLs from a list file that already exist as pages, plus imports any URL the archive does not yet track
 * 5. `--append` mode: Adds new recursive roots to an existing archive
 * 6. `--retry-failed` mode: Re-fetches failed pages in an existing archive
 * 7. `--list-file` / `--list` mode: Crawls a pre-defined URL list (non-recursive)
 * 8. Default mode: Crawls from one or more root URLs
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
	const hasRecrawlFlag = !!flags.recrawl;

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
		if (hasRecrawlFlag) {
			throw new Error('--diff cannot be combined with --recrawl.');
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
		// A dedicated, single-step task list covers just this check
		// (issue #294): it's the very first thing the process does, before
		// any archive/setup display exists, so without it a slow Chrome
		// lookup looks like the process hasn't started at all.
		if (flags.silent) {
			await assertBrowserIsUsable();
		} else {
			try {
				await TaskList.pipe('Checking browser', assertBrowserIsUsable).run({
					stream: process.stderr,
					verbose: !!flags.verbose,
					keepElapsed: true,
				});
			} catch (error) {
				// Unwrapped so a missing-Chrome message stays actionable
				// (install instructions) instead of dealer's generic
				// step-wrapper text (issue #294).
				throw unwrapTaskListStepError(error);
			}
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
			if (hasRecrawlFlag) {
				throw new Error(
					'--resume and --recrawl cannot be used together. Pick the existing-archive mode that fits your task.',
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
			if (hasRecrawlFlag) {
				throw new Error(
					'--inventory and --recrawl cannot be used together. Pick the mode that fits your task — --recrawl also imports novel URLs.',
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

		if (hasRecrawlFlag) {
			if (hasAppendFlag) {
				throw new Error(
					'--recrawl and --append cannot be used together. Pick the existing-archive mode that fits your task.',
				);
			}
			if (flags.retryFailed) {
				throw new Error(
					'--recrawl and --retry-failed cannot be used together. Pick the existing-archive mode that fits your task.',
				);
			}
			if (flags.output) {
				throw new Error(
					'--output flag is not supported with --recrawl. The archive path is the positional argument being recrawled.',
				);
			}
			if (flags.listFile) {
				throw new Error('--recrawl cannot be combined with --list-file.');
			}
			if (hasListFlag) {
				throw new Error('--recrawl cannot be combined with --list.');
			}
			if (flags.single) {
				throw new Error('--recrawl cannot be combined with --single.');
			}
			if (args.length === 0) {
				throw new Error(
					'--recrawl requires the archive path as the positional argument (usage: crawl <archive> --recrawl <urls.txt>).',
				);
			}
			if (args.length > 1) {
				throw new Error(
					'--recrawl takes exactly one positional argument (the archive path).',
				);
			}
			await recrawlCrawl(args[0]!, flags.recrawl!, flags);
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
