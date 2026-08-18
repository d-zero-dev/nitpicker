import type { CrawlerError, CrawlerOrchestrator } from '@nitpicker/crawler';

import { Lanes } from '@d-zero/dealer';
import c from 'ansi-colors';

import { createCountProgressLogger } from '../create-count-progress-logger.js';
import { formatLogLine } from '../format-log-line.js';

type LogType = 'verbose' | 'normal' | 'silent';

/** The single `Lanes` line every crawl-phase update in this module overwrites. */
const PROGRESS_LANE_ID = 0;

/** Return value of {@link attachCrawlDisplay}. */
export interface CrawlDisplayHandle {
	/**
	 * Releases the `Lanes` line. Call once `CrawlerOrchestrator.*`'s factory
	 * call has resolved (crawling and URL sorting are both done, per that
	 * static method's own internals) and before starting the post-crawl
	 * task list (`runPostCrawlTaskList`) — the two must never render at once
	 * (see `Lanes`/`Display`'s single-instance-per-stream invariant).
	 */
	close: () => void;
}

/** Options for {@link attachCrawlDisplay}. */
export interface AttachCrawlDisplayOptions {
	/** The CrawlerOrchestrator to listen on. */
	orchestrator: CrawlerOrchestrator;
	/** Lines to display at the start (URL + config summary). */
	initialLog: string[];
	/** Verbosity level; `'silent'` suppresses all output. */
	logType: LogType;
	/** Crawl-time errors are pushed here as they arrive. */
	errStack: (CrawlerError | Error)[];
}

/**
 * Subscribes to the crawl body's own progress events for CLI display and
 * error collection, covering exactly the crawl phase — from the moment
 * `CrawlerOrchestrator.*`'s `initializedCallback` fires (crawling is about
 * to start) through that static method's `crawling()` + `#setUrlOrder()`
 * calls, both awaited before it returns.
 *
 * Deliberately excludes `orchestrator.write()`'s events
 * (`writeFileStart`/`writeStep`/`writeTarProgress`/`writeFileEnd`) — that
 * call happens later, from the post-crawl task list's own `'Write archive'`
 * row (`run-post-crawl-task-list.ts`), which subscribes to those events
 * itself for the duration of its own step. Splitting the two keeps this
 * module's `Lanes` line scoped to a single phase, so the caller can close it
 * (see {@link CrawlDisplayHandle.close}) the instant the crawl body itself
 * is done, before the task list's `Lanes` line ever opens (`Lanes`/`Display`
 * cannot have two live instances on the same stream at once).
 *
 * `logType === 'verbose'` switches the `Lanes` line to `Lanes`' append-with-
 * timestamp mode instead of overwriting a single line — the same convention
 * as `viewer-build.ts`'s progress display (issue #294), for timing which
 * part of a slow crawl is the bottleneck. Relays `flushingPendingWrites`
 * (issue #294: the crawl body's own per-page display has already stopped by
 * `crawlEnd`, so a `WriteQueue` still draining queued writes would otherwise
 * look like a hang) and `sortingUrls` (issue #294: `setUrlOrder()` runs
 * after crawling finishes and can take seconds to minutes on a large
 * archive) — both fire before the factory call returns, so they can never
 * arrive after {@link CrawlDisplayHandle.close} has run. `'error'` events
 * are pushed straight into `errStack` — `TypedAwaitEventEmitter` has no
 * `off()`, but that's fine: `orchestrator` is disposed by the caller shortly
 * after the post-crawl task list finishes, so a listener with nothing left
 * to fire on is harmless.
 *
 * Also subscribes to `recoveringArchiveWrite`, even though it can only fire
 * long after {@link CrawlDisplayHandle.close} has already run: it's emitted
 * by `[Symbol.asyncDispose]`'s recovery write, which only happens if
 * `orchestrator.write()` itself (called from the post-crawl task list's own
 * `'Write archive'` row) threw before finishing — a case where that row's
 * `Lanes` has already torn down too. Reported as a plain `console.error`
 * line rather than through the (by then long-closed) `Lanes` instance, so a
 * recovery write that takes a while doesn't look hung with no explanation.
 *
 
 * WHY stderr: crawl progress output is informational and should not
 * interfere with stdout, which may be piped to other tools.
 * @param options - See {@link AttachCrawlDisplayOptions}.
 * @param options.orchestrator
 * @param options.initialLog
 * @param options.logType
 * @param options.errStack
 * @returns A {@link CrawlDisplayHandle}.
 * @example
 * ```ts
 * const display = attachCrawlDisplay({
 *   orchestrator,
 *   initialLog: ['🐳 https://example.com (New scraping)'],
 *   logType: flags.verbose ? 'verbose' : flags.silent ? 'silent' : 'normal',
 *   errStack,
 * });
 * // ...crawling happens inside the factory call...
 * display.close(); // before the post-crawl TaskList starts
 * ```
 */
export function attachCrawlDisplay({
	orchestrator,
	initialLog,
	logType,
	errStack,
}: AttachCrawlDisplayOptions): CrawlDisplayHandle {
	if (logType === 'silent') {
		return { close: () => {} };
	}

	const [firstLine, ...restLines] = initialLog;
	process.stderr.write(
		[c.bold(firstLine ?? ''), ...restLines.map((l) => c.dim(l))].join('\n') + '\n',
	);

	const verbose = logType === 'verbose';
	const lanes = new Lanes({ verbose, indent: '  ', stream: process.stderr });
	const log = (message: string) => {
		lanes.update(PROGRESS_LANE_ID, formatLogLine(verbose, message));
	};

	orchestrator.on('error', (error) => {
		errStack.push(error);
	});

	orchestrator.on('flushingPendingWrites', ({ pending }) => {
		log(`%braille% Flushing ${pending} pending write(s)%dots%`);
	});

	const sortingUrlsLogger = createCountProgressLogger(log, 'Sorting pages');
	orchestrator.on('sortingUrls', ({ processed, total }) => {
		sortingUrlsLogger(processed, total);
	});

	orchestrator.on('recoveringArchiveWrite', () => {
		// eslint-disable-next-line no-console -- this fires well after `lanes` has closed; see the JSDoc above
		console.error('[nitpicker] Recovering: retrying archive write');
	});

	return {
		close: () => {
			lanes.close();
		},
	};
}
