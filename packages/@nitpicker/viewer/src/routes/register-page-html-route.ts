import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { getPageHtml } from '@nitpicker/query';

import { toNumber } from '../query-params/to-number.js';

/**
 * Registers `GET /api/pages/html?url=&maxLength=` — stored HTML snapshot.
 *
 * Returns `{ html, truncated }` as JSON; the frontend renders it inside a
 * sandboxed iframe or as source.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerPageHtmlRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/pages/html', async (c) => {
		const url = c.req.query('url');
		if (!url) {
			return c.json({ error: 'Missing required query parameter: url' }, 400);
		}
		const accessor = context.manager.get(context.archiveId);
		const result = await getPageHtml(accessor, url, toNumber(c.req.query('maxLength')));
		if (!result) {
			return c.json({ error: 'HTML snapshot not found' }, 404);
		}
		return c.json(result);
	});
}
