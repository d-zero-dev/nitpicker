import type { ArchiveContext } from '../types.js';
import type { ListPageLinksOptions } from '@nitpicker/query';
import type { Hono } from 'hono';

import { listPageLinks } from '@nitpicker/query';

import { toBoolean } from '../query-params/to-boolean.js';
import { toNumber } from '../query-params/to-number.js';

/**
 * Registers `GET /api/page-links` — per-page network info (google-sheets
 * "Links" sheet equivalent: one row per page with status, redirects,
 * referrer count, headers).
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerPageLinksRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/page-links', async (c) => {
		const q = c.req.query();
		const accessor = context.manager.get(context.archiveId);
		const options: ListPageLinksOptions = {
			isExternal: toBoolean(q.isExternal),
			urlPattern: q.urlPattern,
			limit: toNumber(q.limit),
			offset: toNumber(q.offset),
		};
		return c.json(await listPageLinks(accessor, options));
	});
}
