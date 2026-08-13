import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import {
	getTechnologyDirectoryDistribution,
	getTechnologyInventoryFastPath,
	listPagesByTechnology,
} from '@nitpicker/query';

/**
 * Registers `GET /api/technologies` — the site-wide technology inventory
 * (one entry per detected technology) plus the directory × technology
 * distribution matrix. Takes no query parameters — technology counts are
 * always in the low hundreds at most, so pagination would add complexity
 * without a real payload-size problem to solve (same rationale as
 * `registerTemplateClustersRoute`).
 *
 * `directoryDistribution` is `[]` when the viewer read model has not been
 * built (or is stale) — see `getTechnologyDirectoryDistribution`'s docs;
 * `inventory` dispatches between the read-model fast path and the live
 * `GROUP BY` aggregation via `getTechnologyInventoryFastPath`.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerTechnologiesRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/technologies', async (c) => {
		const accessor = context.manager.get(context.archiveId);
		const [inventory, directoryDistribution] = await Promise.all([
			getTechnologyInventoryFastPath(accessor),
			getTechnologyDirectoryDistribution(accessor),
		]);
		return c.json({ inventory, directoryDistribution });
	});

	// Drill-down for one technology's page list — the `/technologies` view's
	// inline expansion when a row is clicked. Deliberately its own endpoint
	// rather than a `technology` filter wired into `/api/pages`'s
	// fast/live-path pipeline: `page_technologies` is one-page-to-many, so
	// integrating it there would need the same whereIn-subquery treatment
	// `templateKey` gets, across both the fast (`viewer_pages`) and live
	// (`content_items`) paths — out of scope for this pass.
	app.get('/api/technologies/pages', async (c) => {
		const technology = c.req.query('technology');
		if (!technology) {
			return c.json({ error: 'Missing required query parameter: technology' }, 400);
		}
		const accessor = context.manager.get(context.archiveId);
		const minConfidence = c.req.query('minConfidence');
		const limit = c.req.query('limit');
		const offset = c.req.query('offset');
		const result = await listPagesByTechnology(accessor, {
			technology,
			minConfidence: minConfidence ? Number(minConfidence) : undefined,
			limit: limit ? Number(limit) : undefined,
			offset: offset ? Number(offset) : undefined,
		});
		return c.json(result);
	});
}
