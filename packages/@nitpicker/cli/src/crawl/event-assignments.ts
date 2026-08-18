import type { CrawlerOrchestrator } from '@nitpicker/crawler';

import { Lanes } from '@d-zero/dealer';
import c from 'ansi-colors';

import { createByteProgressLogger } from '../create-byte-progress-logger.js';
import { createCountProgressLogger } from '../create-count-progress-logger.js';
import { formatLogLine } from '../format-log-line.js';
import { WRITE_STEP_LABELS } from '../write-step-labels.js';

type LogType = 'verbose' | 'normal' | 'silent';

/** The single `Lanes` line every write-progress update in this module overwrites. */
const PROGRESS_LANE_ID = 0;

/**
 * Registers event listeners on the CrawlerOrchestrator for CLI progress display.
 *
 * Outputs the initial configuration summary to stderr, then listens for
 * `error`, `flushingPendingWrites`, `sortingUrls`, `recoveringArchiveWrite`,
 * and the archive-write lifecycle events (`writeFileStart`, `writeStep`,
 * `writeTarProgress`, `writeFileEnd`). Returns a Promise that resolves when
 * the archive file has been written or rejects on error.
 *
 * `logType === 'verbose'` switches the shared `Lanes` line to `Lanes`'
 * append-with-timestamp mode instead of overwriting a single line — the
 * same convention as `viewer-build.ts`'s progress display (issue #294),
 * for timing which step of a slow write is the bottleneck. Relays
 * `flushingPendingWrites` (issue #294: the deal's own display has already
 * stopped by `crawlEnd`, so a `WriteQueue` still draining queued writes
 * would otherwise look like a hang), `sortingUrls` (issue #294:
 * `setUrlOrder()` runs after crawling finishes and can take seconds to
 * minutes on a large archive), `recoveringArchiveWrite` (issue #294: the
 * rare case where `[Symbol.asyncDispose]` finds the archive still unwritten
 * and retries — explains the `writeStep`/`writeTarProgress` updates that
 * follow it, which would otherwise look like a second, unexplained write
 * after the first one already appeared to fail), `writeStep` (issue #294:
 * `checkpoint`/`remove` have no countable progress of their own, so
 * without a label the display would sit static — indistinguishable from a
 * stall — for however long those steps take), and `writeTarProgress` (a
 * 15 GB+ archive's tar step can run for minutes).
 *
 * WHY stderr: The crawl progress output is informational and should not
 * interfere with stdout, which may be piped to other tools.
 * @param orchestrator - The CrawlerOrchestrator to listen on
 * @param initialLog - Lines to display at the start (URL + config summary)
 * @param logType - Verbosity level; `'silent'` suppresses all output
 */
export async function eventAssignments(
	orchestrator: CrawlerOrchestrator,
	initialLog: string[],
	logType: LogType,
): Promise<void> {
	if (logType === 'silent') {
		return;
	}

	const [firstLine, ...restLines] = initialLog;
	process.stderr.write(
		[c.bold(firstLine ?? ''), ...restLines.map((l) => c.dim(l))].join('\n') + '\n',
	);

	const verbose = logType === 'verbose';
	// Not scoped inside the Promise executor below: a `using` declared there
	// would be disposed (its redraw timer cleared) the instant the
	// synchronous executor function returns, long before the async
	// `writeFileEnd`/`error` events this Promise actually waits on arrive.
	using lanes = new Lanes({ verbose, indent: '  ', stream: process.stderr });
	const log = (message: string) => {
		lanes.update(PROGRESS_LANE_ID, formatLogLine(verbose, message));
	};

	await new Promise<void>((resolve, reject) => {
		orchestrator.on('error', (error) => {
			reject(error);
		});

		orchestrator.on('flushingPendingWrites', ({ pending }) => {
			log(`%braille% Flushing ${pending} pending write(s)%dots%`);
		});

		orchestrator.on('recoveringArchiveWrite', () => {
			log('%braille% Recovering: retrying archive write%dots%');
		});

		const sortingUrlsLogger = createCountProgressLogger(log, 'Sorting pages');
		orchestrator.on('sortingUrls', ({ processed, total }) => {
			sortingUrlsLogger(processed, total);
		});

		orchestrator.on('writeFileStart', ({ filePath }) => {
			log(`%braille% Writing to: ${filePath}%dots%`);
		});

		orchestrator.on('writeStep', ({ step }) => {
			log(`%braille% ${WRITE_STEP_LABELS[step]}%dots%`);
		});

		const tarProgressLogger = createByteProgressLogger(log, 'Writing archive');
		orchestrator.on('writeTarProgress', ({ writtenBytes, totalBytes }) => {
			tarProgressLogger(writtenBytes, totalBytes);
		});

		orchestrator.on('writeFileEnd', ({ filePath }) => {
			log(`Done: ${filePath}`);
			resolve();
		});
	});
}
