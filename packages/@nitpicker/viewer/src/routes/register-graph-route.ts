import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { getLinkGraph } from '@nitpicker/query';

import { toNumber } from '../query-params/to-number.js';

/**
 * Registers `GET /api/graph?limit=` — the internal-page link graph (nodes +
 * edges). `limit` caps nodes to the highest in-degree pages (omit for all).
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerGraphRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/graph', async (c) => {
		const accessor = context.manager.get(context.archiveId);
		return c.json(
			await getLinkGraph(accessor, { limit: toNumber(c.req.query('limit')) }),
		);
	});
}
