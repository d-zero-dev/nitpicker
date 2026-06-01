import type { ArchiveContext } from '../types.js';
import type { ListResourcesOptions } from '@nitpicker/query';
import type { Hono } from 'hono';

import { listResources } from '@nitpicker/query';

import { toBoolean } from '../query-params/to-boolean.js';
import { toNumber } from '../query-params/to-number.js';

/**
 * Registers `GET /api/resources` — paginated, filterable resource list.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerResourcesRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/resources', async (c) => {
		const q = c.req.query();
		const accessor = context.manager.get(context.archiveId);
		const options: ListResourcesOptions = {
			contentType: q.contentType,
			isExternal: toBoolean(q.isExternal),
			limit: toNumber(q.limit),
			offset: toNumber(q.offset),
		};
		return c.json(await listResources(accessor, options));
	});
}
