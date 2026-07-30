import type { ArchiveContext } from '../types.js';
import type { ListDuplicateBodyClustersOptions } from '@nitpicker/query';
import type { Hono } from 'hono';

import { getCachedDuplicateBodyClusters } from '../duplicate-clusters-cache.js';
import { toNumber } from '../query-params/to-number.js';

/**
 * Registers `GET /api/duplicate-clusters?minCount=&limit=&offset=&samplePagesLimit=`
 * — same-`body_hash` clusters filtered and ranked for "is this a
 * self-generating crawl trap" (issue #208), via
 * `@nitpicker/query`'s `listDuplicateBodyClusters`. See that function's own
 * JSDoc for the filtering/ranking rules (minimum size, uniform title,
 * `ogUrlMismatchRatio` descending).
 *
 * Query params are all optional; `listDuplicateBodyClusters` applies its own
 * defaults (`minCount: 10`, `limit: 50`, `samplePagesLimit: 20`) when
 * omitted.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerDuplicateClustersRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/duplicate-clusters', async (c) => {
		const options: ListDuplicateBodyClustersOptions = {
			minCount: toNumber(c.req.query('minCount')),
			limit: toNumber(c.req.query('limit')),
			offset: toNumber(c.req.query('offset')),
			samplePagesLimit: toNumber(c.req.query('samplePagesLimit')),
		};
		return c.json(await getCachedDuplicateBodyClusters(context, options));
	});
}
