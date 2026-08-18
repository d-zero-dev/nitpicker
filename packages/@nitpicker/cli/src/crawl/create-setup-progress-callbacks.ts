import type { SetupProgressCallbacks } from '@nitpicker/crawler';

import { formatProgressCount } from '../format-progress-count.js';

/**
 * Builds the `SetupProgressCallbacks` the CLI passes into
 * `CrawlerOrchestrator.append`/`inventory`/`retryFailed` (issue #294).
 *
 * `onExtractProgress`/`onCopyProgress`/`onChunkProgress` are generic byte-
 * or count-based callbacks shared across every setup step (see
 * {@link SetupProgressCallbacks}'s JSDoc), so this tracks the label from the
 * most recent `onPhase` call and prefixes every subsequent progress line
 * with it until the next `onPhase`. Renders are deduplicated on the
 * message string, same de-dup strategy as `create-byte-progress-logger.ts` /
 * `create-count-progress-logger.ts`.
 * @param log - Called with the rendered message whenever it changes.
 * @returns A `SetupProgressCallbacks` object suitable for passing directly
 *   to `CrawlerOrchestrator.append`/`inventory`/`retryFailed`.
 */
export function createSetupProgressCallbacks(
	log: (message: string) => void,
): SetupProgressCallbacks {
	let currentLabel = '';
	let lastMessage = '';
	const emit = (message: string) => {
		if (message === lastMessage) {
			return;
		}
		lastMessage = message;
		log(message);
	};
	const emitBytes = (bytes: number, totalBytes: number) => {
		emit(
			`%braille% ${currentLabel}: ${formatProgressCount(
				Math.round(bytes / 1_000_000),
				Math.round(totalBytes / 1_000_000),
				'MB',
			)}`,
		);
	};
	return {
		onPhase: (label) => {
			currentLabel = label;
			emit(`%braille% ${label}%dots%`);
		},
		onExtractProgress: emitBytes,
		onCopyProgress: emitBytes,
		onChunkProgress: (processed, total) => {
			emit(`%braille% ${currentLabel}: ${formatProgressCount(processed, total)}`);
		},
	};
}
