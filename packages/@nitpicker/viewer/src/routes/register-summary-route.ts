import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { getSummary } from '@nitpicker/query';

/**
 * Registers `GET /api/summary` — site-wide summary statistics.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerSummaryRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/summary', async (c) => {
		const accessor = context.manager.get(context.archiveId);
		return c.json(await getSummary(accessor));
	});
}
