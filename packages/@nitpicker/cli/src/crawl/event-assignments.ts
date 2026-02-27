import type { CrawlerOrchestrator } from '@nitpicker/crawler';

import c from 'ansi-colors';

type LogType = 'verbose' | 'normal' | 'silent';

/**
 * Registers event listeners on the CrawlerOrchestrator for CLI progress display.
 *
 * Outputs the initial configuration summary to stderr, then listens for
 * `error`, `writeFileStart`, and `writeFileEnd` events. Returns a Promise
 * that resolves when the archive file has been written or rejects on error.
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

	return new Promise((resolve, reject) => {
		const [firstLine, ...restLines] = initialLog;
		process.stderr.write(
			[c.bold(firstLine ?? ''), ...restLines.map((l) => c.dim(l))].join('\n') + '\n',
		);

		orchestrator.on('error', (error) => {
			reject(error);
		});

		orchestrator.on('writeFileStart', ({ filePath }) => {
			process.stderr.write(`📥 Writing to: ${c.cyan(filePath)}\n`);
		});

		orchestrator.on('writeFileEnd', ({ filePath }) => {
			process.stderr.write(`📥 Done: ${c.cyan(filePath)}\n`);
			resolve();
		});
	});
}
