import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { getPageTechnologies } from '@nitpicker/query';

/**
 * Registers `GET /api/pages/technologies?url=` — every detected technology
 * for a single page, confidence descending, with every raw signal that
 * contributed to it. The "根拠を見る" (show evidence) drill-down the Page
 * Detail view's technologies section expands into on demand — `getPageDetail`
 * already returns a lightweight `technologies` summary inline, without
 * per-signal evidence.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerPageTechnologiesRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/pages/technologies', async (c) => {
		const url = c.req.query('url');
		if (!url) {
			return c.json({ error: 'Missing required query parameter: url' }, 400);
		}
		const accessor = context.manager.get(context.archiveId);
		const technologies = await getPageTechnologies(accessor, url);
		return c.json({ technologies });
	});
}
