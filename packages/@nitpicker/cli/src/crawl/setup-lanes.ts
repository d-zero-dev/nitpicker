import type { SetupProgressCallbacks } from '@nitpicker/crawler';

import { Lanes } from '@d-zero/dealer';

import { formatLogLine } from '../format-log-line.js';

import { createSetupProgressCallbacks } from './create-setup-progress-callbacks.js';

/** Return value of {@link createSetupLanes}. */
export interface SetupLanesHandle {
	/** Pass directly to `CrawlerOrchestrator.append`/`inventory`/`retryFailed`. */
	setupProgress: SetupProgressCallbacks;
	/** Releases the `Lanes` instance. Call once the setup phase has ended. */
	close: () => void;
}

/**
 * Opens a dedicated `Lanes` instance for the pre-crawl setup phase (untar,
 * `.bak` copy, repromote/reset, state rebuild) of
 * `CrawlerOrchestrator.append`/`inventory`/`retryFailed` (issue #294).
 *
 * The returned `close()` must run before the crawl itself starts — i.e.
 * inside `initializedCallback`, right before handing off to the CLI's own
 * `eventAssignments`-driven display. `Lanes`'s repaint timer, once started
 * by any `update()` call, keeps repainting on its own schedule until
 * closed; two live `Lanes` instances writing to the same stream at once
 * corrupt each other's cursor-based redraw (each tracks its own line count
 * for the escape sequence that erases the previous frame).
 *
 * If a catastrophic failure happens *after* the crawl has already started
 * (i.e. after `close()` already ran), the orchestrator's setup-phase
 * restore-from-backup progress calls land on the now-closed `Lanes` and are
 * silently dropped (`Lanes.update()` on a closed `Display` is a no-op).
 * Accepted: by that point the deal has already failed and its own error is
 * what surfaces to the operator; re-opening a second `Lanes` for this
 * narrow, already-degraded recovery path isn't worth the added complexity.
 * @param verbose - Whether the current run is in `--verbose` mode.
 * @returns A {@link SetupLanesHandle}.
 */
export function createSetupLanes(verbose: boolean): SetupLanesHandle {
	const lanes = new Lanes({ verbose, indent: '  ', stream: process.stderr });
	const log = (message: string) => {
		lanes.update(0, formatLogLine(verbose, message));
	};
	return {
		setupProgress: createSetupProgressCallbacks(log),
		close: () => {
			lanes.close();
		},
	};
}
