import type { ReadModelUnavailable } from './types.js';
import type { ArchiveMode } from '@nitpicker/query';
import type { Context } from 'hono';

import { shouldRefuseStaleReadModel } from './should-refuse-stale-read-model.js';

/**
 * Builds the {@link ReadModelUnavailable} response for a route whose read
 * model is stale/missing outside stub mode, or `undefined` when the request
 * should proceed. The single definition every read-model-backed list route
 * shares — the `reason` field is reserved for future unavailability reasons,
 * and centralising the payload here means introducing one never requires
 * hand-synchronising a dozen per-route copies.
 * @param c - The Hono request context.
 * @param mode - The archive's mode (`'archive'` or `'stub'`).
 * @param isReadModelCurrent - The result of `isViewerReadModelCurrent` for
 *   this accessor.
 * @returns The JSON response to return verbatim, or `undefined` to proceed.
 * @example
 * const refused = refuseIfStaleReadModel(c, context.mode, isReadModelCurrent);
 * if (refused) {
 *   return refused;
 * }
 */
export function refuseIfStaleReadModel(
	c: Context,
	mode: ArchiveMode,
	isReadModelCurrent: boolean,
): Response | undefined {
	if (!shouldRefuseStaleReadModel(mode, isReadModelCurrent)) {
		return undefined;
	}
	const unavailable: ReadModelUnavailable = {
		available: false,
		reason: 'read-model-required',
	};
	return c.json(unavailable);
}
