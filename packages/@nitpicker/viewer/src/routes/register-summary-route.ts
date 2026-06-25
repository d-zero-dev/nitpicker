import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { getCachedSummary } from '../summary-cache.js';

/**
 * Registers `GET /api/summary` — site-wide summary statistics.
 *
 * The viewer caches the computed `SummaryResult` per `archiveId` so
 * second and later hits return from in-process memory without
 * re-entering SQLite. See {@link getCachedSummary} for the
 * archive-vs-stub mode semantics.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerSummaryRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/summary', async (c) => {
		return c.json(await getCachedSummary(context));
	});
}
