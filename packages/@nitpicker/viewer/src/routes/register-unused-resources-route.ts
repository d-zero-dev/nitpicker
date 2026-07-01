import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { listUnusedResources } from '@nitpicker/query';

import { toNumber } from '../query-params/to-number.js';

/**
 * Registers `GET /api/unused-resources` — internal sub-resources that no
 * archived page references. Used by the viewer's "unused file" surface
 * to highlight candidates for deletion from the server.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerUnusedResourcesRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/unused-resources', async (c) => {
		const accessor = context.manager.get(context.archiveId);
		const result = await listUnusedResources(accessor, {
			urlPattern: c.req.query('urlPattern'),
			contentType: c.req.query('contentType'),
			source: c.req.query('source') as
				| 'crawled'
				| 'inventory-seed'
				| 'inventory-discovered'
				| undefined,
			sortBy: c.req.query('sortBy') as
				| 'url'
				| 'status'
				| 'contentType'
				| 'contentLength'
				| 'source'
				| undefined,
			sortOrder: c.req.query('sortOrder') as 'asc' | 'desc' | undefined,
			limit: toNumber(c.req.query('limit')),
			offset: toNumber(c.req.query('offset')),
		});
		return c.json(result);
	});
}
