import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { listDirectoryPages } from '@nitpicker/query';

import { toNumber } from '../query-params/to-number.js';

/**
 * Registers `GET /api/directory-tree/pages?nodeId=<id>&cursor=&limit=` —
 * cursor-paginated direct pages of one directory node (never its
 * descendants — see `listDirectoryPages`'s docs).
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerDirectoryTreePagesRoute(
	app: Hono,
	context: ArchiveContext,
): void {
	app.get('/api/directory-tree/pages', async (c) => {
		const nodeId = toNumber(c.req.query('nodeId'));
		if (nodeId == null) {
			return c.json({ error: 'Missing required query parameter: nodeId' }, 400);
		}
		const accessor = context.manager.get(context.archiveId);
		const result = await listDirectoryPages(accessor, {
			nodeId,
			cursor: c.req.query('cursor') || undefined,
			limit: toNumber(c.req.query('limit')),
		});
		return c.json(result);
	});
}
