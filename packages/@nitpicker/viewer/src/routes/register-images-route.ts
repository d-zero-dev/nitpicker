import type { ArchiveContext } from '../types.js';
import type { ListImagesOptions } from '@nitpicker/query';
import type { Hono } from 'hono';

import { listImages } from '@nitpicker/query';

import { toBoolean } from '../query-params/to-boolean.js';
import { toNumber } from '../query-params/to-number.js';

/**
 * Registers `GET /api/images` — paginated, filterable image list.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerImagesRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/images', async (c) => {
		const q = c.req.query();
		const accessor = context.manager.get(context.archiveId);
		const options: ListImagesOptions = {
			missingAlt: toBoolean(q.missingAlt),
			missingDimensions: toBoolean(q.missingDimensions),
			oversizedThreshold: toNumber(q.oversizedThreshold),
			urlPattern: q.urlPattern,
			sortBy: q.sortBy as ListImagesOptions['sortBy'],
			sortOrder: q.sortOrder as ListImagesOptions['sortOrder'],
			limit: toNumber(q.limit),
			offset: toNumber(q.offset),
		};
		return c.json(await listImages(accessor, options));
	});
}
