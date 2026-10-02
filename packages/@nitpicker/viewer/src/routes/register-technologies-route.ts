import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { getTechnologyInventoryFastPath } from '@nitpicker/query';

/**
 * Registers `GET /api/technologies` — the site-wide technology inventory
 * (one entry per detected technology). Takes no query parameters —
 * technology counts are always in the low hundreds at most, so pagination
 * would add complexity without a real payload-size problem to solve (same
 * rationale as `registerTemplateClustersRoute`). `inventory` dispatches
 * between the read-model fast path and the live `GROUP BY` aggregation via
 * `getTechnologyInventoryFastPath`.
 *
 * Deliberately not served here: a per-technology page list and a
 * directory × technology breakdown. The page list is `/api/pages` with its
 * `technology` filter, so paging, sorting and the other filters come for
 * free; "where on the site" is answered by the directory tree and the
 * template clusters.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerTechnologiesRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/technologies', async (c) => {
		const accessor = context.manager.get(context.archiveId);
		const inventory = await getTechnologyInventoryFastPath(accessor);
		return c.json({ inventory });
	});
}
