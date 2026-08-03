import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { listNetworkOutages } from '@nitpicker/query';

/**
 * Effectively-unbounded page size — the Summary view needs every recorded
 * outage to compute a total count/duration, not a page of them. See
 * `@nitpicker/query`'s `list-all-outage-windows.ts` for the identical
 * rationale on the query-package side.
 */
const ALL_OUTAGES_LIMIT = 10_000;

/**
 * Registers `GET /api/network-outages` — recorded operator-network outages
 * (periods where the crawl operator's own connectivity, not the target
 * sites, was suspected down). Backs the Summary view's "N failures may
 * clear after `crawl --retry-failed`" notice.
 *
 * No cache layer, unlike `/api/summary` / `/api/error-kinds`: `listNetworkOutages`
 * is already a small, direct `network_outages` read with no separate
 * fast-path/live split to dispatch between, so there is no expensive
 * aggregation here worth memoizing. Live in stub mode too — an outage
 * recorded moments ago by an in-progress crawl should show up immediately,
 * not be frozen out by a stale cache the way `getSummary`'s heavier
 * aggregation would be.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerNetworkOutagesRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/network-outages', async (c) => {
		const accessor = context.manager.get(context.archiveId);
		const result = await listNetworkOutages(accessor, { limit: ALL_OUTAGES_LIMIT });
		return c.json(result);
	});
}
