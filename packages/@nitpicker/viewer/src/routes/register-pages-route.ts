import type { ArchiveContext } from '../types.js';
import type { ListPagesOptions } from '@nitpicker/query';
import type { Hono } from 'hono';

import { listPages } from '@nitpicker/query';

import { toBoolean } from '../query-params/to-boolean.js';
import { toNumber } from '../query-params/to-number.js';

/**
 * Registers `GET /api/pages` — paginated, filterable, sortable page list.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerPagesRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/pages', async (c) => {
		const q = c.req.query();
		const accessor = context.manager.get(context.archiveId);
		const options: ListPagesOptions = {
			status: toNumber(q.status),
			statusMin: toNumber(q.statusMin),
			statusMax: toNumber(q.statusMax),
			isExternal: toBoolean(q.isExternal),
			missingTitle: toBoolean(q.missingTitle),
			missingDescription: toBoolean(q.missingDescription),
			noindex: toBoolean(q.noindex),
			urlPattern: q.urlPattern,
			directory: q.directory,
			sortBy: q.sortBy as ListPagesOptions['sortBy'],
			sortOrder: q.sortOrder as ListPagesOptions['sortOrder'],
			limit: toNumber(q.limit),
			offset: toNumber(q.offset),
		};
		return c.json(await listPages(accessor, options));
	});
}
