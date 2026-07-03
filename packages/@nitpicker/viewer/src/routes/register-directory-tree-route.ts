import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { getDirectoryTree } from '@nitpicker/query';

/**
 * Registers `GET /api/directory-tree` — the initial (depth ≤ 3) directory
 * tree for every root (host) in the archive, as a flat parent-linked node
 * list per root. The frontend builds the nested UI tree client-side from
 * `parentNodeId` links; this endpoint never recurses server-side.
 *
 * Takes no query parameters — the archive already knows which hosts it
 * crawled, so there is nothing for a caller to specify up front.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerDirectoryTreeRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/directory-tree', async (c) => {
		const accessor = context.manager.get(context.archiveId);
		const roots = await getDirectoryTree(accessor);
		return c.json({ roots });
	});
}
