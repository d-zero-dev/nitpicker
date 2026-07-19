import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { listDirectoryChildren } from '@nitpicker/query';

import { toNumber } from '../query-params/to-number.js';

/**
 * Registers `GET /api/directory-tree/children?nodeId=<id>` — the direct
 * child directory nodes of one node, for on-demand expansion of directories
 * beyond the initial depth ≤ 3 load returned by `/api/directory-tree`.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerDirectoryTreeChildrenRoute(
	app: Hono,
	context: ArchiveContext,
): void {
	app.get('/api/directory-tree/children', async (c) => {
		const nodeId = toNumber(c.req.query('nodeId'));
		if (nodeId == null) {
			return c.json({ error: 'Missing required query parameter: nodeId' }, 400);
		}
		const accessor = context.manager.get(context.archiveId);
		const nodes = await listDirectoryChildren(accessor, { nodeId });
		return c.json({ nodes });
	});
}
