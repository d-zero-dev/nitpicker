import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { getPageDetail } from '@nitpicker/query';

/**
 * Registers `GET /api/pages/detail?url=` — full detail for a single page.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerPageDetailRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/pages/detail', async (c) => {
		const url = c.req.query('url');
		if (!url) {
			return c.json({ error: 'Missing required query parameter: url' }, 400);
		}
		const accessor = context.manager.get(context.archiveId);
		const result = await getPageDetail(accessor, url);
		if (!result) {
			return c.json({ error: 'Page not found' }, 404);
		}
		return c.json(result);
	});
}
