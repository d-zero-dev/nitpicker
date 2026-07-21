import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { getPageMainContents } from '@nitpicker/query';

/**
 * Registers `GET /api/pages/main-contents?url=` — the main-content region's
 * aggregate counts plus all 8 child-entity details (headings, images,
 * tables, buttons, iframes, videos, audios, canvases) for a single page.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerPageMainContentsRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/pages/main-contents', async (c) => {
		const url = c.req.query('url');
		if (!url) {
			return c.json({ error: 'Missing required query parameter: url' }, 400);
		}
		const accessor = context.manager.get(context.archiveId);
		const result = await getPageMainContents(accessor, url);
		if (!result) {
			return c.json({ error: 'Page not found or not rendered' }, 404);
		}
		return c.json(result);
	});
}
