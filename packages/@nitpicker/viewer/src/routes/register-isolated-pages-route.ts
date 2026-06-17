import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { listIsolatedPages } from '@nitpicker/query';

import { toNumber } from '../query-params/to-number.js';

/**
 * Registers `GET /api/isolated-pages` — internal HTML pages with no
 * inbound anchors, excluding archived roots. Used by the viewer's
 * "orphan LP" surface to highlight pages that the recursive crawl
 * could not reach via the link graph.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerIsolatedPagesRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/isolated-pages', async (c) => {
		const accessor = context.manager.get(context.archiveId);
		const result = await listIsolatedPages(accessor, {
			limit: toNumber(c.req.query('limit')),
			offset: toNumber(c.req.query('offset')),
		});
		return c.json(result);
	});
}
