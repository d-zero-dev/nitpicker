import type { StepContext } from '@d-zero/dealer';
import type { CrawlerError, CrawlerOrchestrator } from '@nitpicker/crawler';

import { TaskList } from '@d-zero/dealer';
import c from 'ansi-colors';

import { dedupeProgressMessage } from '../dedupe-progress-message.js';
import { formatProgressCount } from '../format-progress-count.js';

import { createVerboseTimestampStream } from './create-verbose-timestamp-stream.js';

/** Return value of {@link attachCrawlDisplay}. */
export interface CrawlDisplayHandle {
	/**
	 * Resolves once both rows have settled (`done`/`skipped`), or rejects
	 * with a `TaskListStepError` if {@link CrawlDisplayHandle.fail} rejected
	 * the row that was active. Await this after
	 * {@link CrawlDisplayHandle.finish} (success path) or alongside
	 * {@link CrawlDisplayHandle.fail} (failure path, to observe and swallow
	 * the rejection before the caller re-throws its own error — otherwise
	 * the rejection goes unhandled).
	 */
	readonly taskListDone: Promise<void>;
	/**
	 * Call once `CrawlerOrchestrator.*`'s factory call has resolved
	 * successfully (crawling and URL sorting are both done, per that static
	 * method's own internals). Marks the active row done and any row never
	 * reached (e.g. `'Flushing pending writes'` when nothing was pending, or
	 * either row when `#setUrlOrder()` had nothing to sort) `'skipped'`, then
	 * lets the task list finish so its `Lanes` releases before the
	 * post-crawl task list starts.
	 */
	finish(): void;
	/**
	 * Call when the factory call itself rejects (`crawling()`/`#setUrlOrder()`
	 * throwing after `initializedCallback` already fired). Rejects the
	 * currently-active row with `error`; the task list stops immediately and
	 * the other row (if not yet reached) stays `pending`.
	 * @param error - The error the factory call rejected with.
	 */
	fail(error: unknown): void;
}

/** Options for {@link attachCrawlDisplay}. */
export interface AttachCrawlDisplayOptions {
	/** The CrawlerOrchestrator to listen on. */
	orchestrator: CrawlerOrchestrator;
	/** Lines to display at the start (URL + config summary). */
	initialLog: string[];
	/** Verbosity level; `'silent'` suppresses all output. */
	logType: 'verbose' | 'normal' | 'silent';
	/** Crawl-time errors are pushed here as they arrive. */
	errStack: (CrawlerError | Error)[];
}

/** The task-list row currently accepting `ctx.progress()` updates. */
interface ActiveRow {
	readonly ctx: StepContext<undefined>;
	readonly resolve: () => void;
	readonly reject: (error: unknown) => void;
}

/**
 * Subscribes to the crawl body's own progress events for CLI display and
 * error collection, covering exactly the crawl phase — from the moment
 * `CrawlerOrchestrator.*`'s `initializedCallback` fires (crawling is about
 * to start) through that static method's `crawling()` + `#setUrlOrder()`
 * calls, both awaited before it returns.
 *
 * Rendered as a two-row `@d-zero/dealer` `TaskList` (issue #294) —
 * `'Flushing pending writes'` → `'Sorting pages'` — rather than a raw
 * `Lanes` line: a `Lanes` line has no `done`/`error` state of its own, so
 * closing it while its message still carries an animation placeholder
 * (`%braille%`) freezes whichever spinner glyph happened to be current at
 * that instant as permanent, unresolved-looking text. `TaskList` rows
 * settle to an explicit `done`/`error` icon instead.
 *
 * `'Flushing pending writes'` is genuinely optional — `flushingPendingWrites`
 * only fires when `WriteQueue.pending > 0` at `crawlEnd` — so this row may
 * never receive a message. It resolves (as `'skipped'` if no message ever
 * arrived) the moment the *first* `sortingUrls` event arrives, since
 * `#setUrlOrder()` (the source of `sortingUrls`) only starts after any
 * pending-write drain has already finished — that first `sortingUrls`
 * event's own progress update is intentionally dropped rather than queued
 * for the row that becomes active a microtask later: `sortingUrls` fires
 * once per chunk, so losing the very first one is imperceptible. If neither
 * event ever fires (nothing to flush, nothing to sort), both rows stay
 * `pending` until {@link CrawlDisplayHandle.finish} settles them via the
 * same `skipRemaining` mechanism `crawl/create-setup-task-list.ts` uses for
 * its own never-reached rows.
 *
 * Deliberately separate from `deal()`'s own crawl-time `Lanes` (which
 * renders the parallel worker-pool lanes themselves) and from the setup/
 * post-crawl `TaskList`s: `deal()`'s `Lanes` closes at `crawlEnd`, and
 * `flushingPendingWrites`/`sortingUrls` both fire strictly after that but
 * before the factory call returns — a window with no display of its own
 * before this function existed. `logType === 'verbose'` switches the render
 * stream to `create-verbose-timestamp-stream.ts`'s wrapper instead of the
 * default overwrite mode — the same convention as every other `TaskList` in
 * this CLI (issue #294).
 *
 * The `TaskList` itself is built eagerly but **not started** (`.run()` is
 * deferred) until the first `flushingPendingWrites`/`sortingUrls` event
 * actually arrives, or until {@link CrawlDisplayHandle.finish}/
 * {@link CrawlDisplayHandle.fail} runs first (the "nothing to flush or
 * sort" edge case). Starting it eagerly at `attachCrawlDisplay` call time
 * (i.e. inside `initializedCallback`, before `deal()`'s own crawl even
 * begins) would violate the `Lanes`/`Display` single-instance-per-stream
 * invariant for the *entire* crawl body's duration — `TaskList.run()`
 * renders an initial frame and starts its own redraw timer immediately,
 * and that timer would keep firing (interleaving broken output with
 * `deal()`'s own redraws) until this phase's rows finally settle, long
 * after `deal()`'s `Lanes` has already started using the same stream.
 *
 * `crawlSessionNotice` (DNS-burn short-circuit / network-outage summaries
 * from `#finalizeCrawlSession`, issue #294 code review) is written onto
 * whichever row is currently active, starting the pipeline first if neither
 * `flushingPendingWrites` nor `sortingUrls` has fired yet — this can
 * overwrite that row's own progress message (a rare notice replacing an
 * in-progress count is an acceptable trade-off against the alternative, a
 * bare `console.error` corrupting the display outright).
 *
 * `'error'` events are pushed straight into `errStack` — `TypedAwaitEventEmitter`
 * has no `off()`, but that's fine: `orchestrator` is disposed by the caller
 * shortly after the post-crawl task list finishes, so a listener with
 * nothing left to fire on is harmless.
 *
 * Also subscribes to `recoveringArchiveWrite`, even though it can only fire
 * long after {@link CrawlDisplayHandle.finish}/{@link CrawlDisplayHandle.fail}
 * have already run: it's emitted by `[Symbol.asyncDispose]`'s recovery
 * write, which only happens if `orchestrator.write()` itself (called from
 * the post-crawl task list's own `'Write archive'` row) threw before
 * finishing — a case where that row's own `TaskList` has already torn down
 * too. Reported as a plain `console.error` line rather than through the (by
 * then long-closed) task list, so a recovery write that takes a while
 * doesn't look hung with no explanation.
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
 * display.finish(); // before the post-crawl TaskList starts
 * await display.taskListDone;
 * ```
 */
export function attachCrawlDisplay({
	orchestrator,
	initialLog,
	logType,
	errStack,
}: AttachCrawlDisplayOptions): CrawlDisplayHandle {
	if (logType === 'silent') {
		return {
			taskListDone: Promise.resolve(),
			finish() {},
			fail() {},
		};
	}

	orchestrator.on('error', (error) => {
		errStack.push(error);
	});

	orchestrator.on('recoveringArchiveWrite', () => {
		// eslint-disable-next-line no-console -- this fires well after the task list has settled; see this function's JSDoc above
		console.error('[nitpicker] Recovering: retrying archive write');
	});

	const [firstLine, ...restLines] = initialLog;
	process.stderr.write(
		[c.bold(firstLine ?? ''), ...restLines.map((l) => c.dim(l))].join('\n') + '\n',
	);

	const bridge: {
		active: ActiveRow | null;
		flushRowResolved: boolean;
		flushMessageSet: boolean;
		skipRemaining: boolean;
		finished: boolean;
		started: boolean;
		resolveTaskListDone: (() => void) | null;
		rejectTaskListDone: ((error: unknown) => void) | null;
	} = {
		active: null,
		flushRowResolved: false,
		flushMessageSet: false,
		skipRemaining: false,
		finished: false,
		started: false,
		resolveTaskListDone: null,
		rejectTaskListDone: null,
	};

	const taskListDone = new Promise<void>((resolve, reject) => {
		bridge.resolveTaskListDone = resolve;
		bridge.rejectTaskListDone = reject;
	});

	const makeStep =
		() =>
		(_input: undefined, ctx: StepContext<undefined>): Promise<undefined> =>
			new Promise<undefined>((resolve, reject) => {
				if (bridge.skipRemaining) {
					ctx.progress('skipped');
					// eslint-disable-next-line unicorn/no-useless-undefined -- `Promise<undefined>`'s resolve requires the argument in this TS config
					resolve(undefined);
					return;
				}
				bridge.active = {
					ctx,
					// eslint-disable-next-line unicorn/no-useless-undefined -- see above
					resolve: () => resolve(undefined),
					reject,
				};
			});

	const verbose = logType === 'verbose';
	const baseStream = process.stderr;
	const stream = verbose ? createVerboseTimestampStream(baseStream) : baseStream;
	const pipeline = TaskList.pipe('Flushing pending writes', makeStep()).pipe(
		'Sorting pages',
		makeStep(),
	);

	/**
	 * Starts rendering (see this function's own JSDoc for why this must
	 * never happen before the first real event/settle call). Idempotent.
	 */
	const startIfNeeded = () => {
		if (bridge.started) {
			return;
		}
		bridge.started = true;
		pipeline.run({ stream, verbose, keepElapsed: true }).then(
			() => bridge.resolveTaskListDone?.(),
			(error: unknown) => bridge.rejectTaskListDone?.(error),
		);
	};

	orchestrator.on('flushingPendingWrites', ({ pending }) => {
		startIfNeeded();
		bridge.flushMessageSet = true;
		bridge.active?.ctx.progress(`${pending} pending write(s)`);
	});

	orchestrator.on('crawlSessionNotice', ({ message }) => {
		startIfNeeded();
		bridge.active?.ctx.progress(message);
	});

	const reportSortingProgress = dedupeProgressMessage((message) => {
		bridge.active?.ctx.progress(message);
	});
	orchestrator.on('sortingUrls', ({ processed, total }) => {
		startIfNeeded();
		if (!bridge.flushRowResolved) {
			bridge.flushRowResolved = true;
			if (!bridge.flushMessageSet) {
				bridge.active?.ctx.progress('skipped');
			}
			bridge.active?.resolve();
			bridge.active = null;
			return;
		}
		reportSortingProgress(formatProgressCount(processed, total, 'pages'));
	});

	return {
		taskListDone,
		finish() {
			if (bridge.finished) {
				return;
			}
			bridge.finished = true;
			bridge.skipRemaining = true;
			startIfNeeded();
			bridge.active?.resolve();
			bridge.active = null;
		},
		fail(error) {
			if (bridge.finished) {
				return;
			}
			bridge.finished = true;
			startIfNeeded();
			bridge.active?.reject(error);
			bridge.active = null;
		},
	};
}
