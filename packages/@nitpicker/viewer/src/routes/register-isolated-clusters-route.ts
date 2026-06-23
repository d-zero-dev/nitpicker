import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { getIsolatedCluster, listIsolatedClusters } from '@nitpicker/query';

import { toNumber } from '../query-params/to-number.js';

/**
 * Registers the isolated-clusters viewer endpoints:
 *
 * - `GET /api/isolated-clusters` — paginated cluster summaries (size ≥ 2),
 *   the **孤立集合** surface for finding interconnected orphan groups.
 * - `GET /api/isolated-clusters/:representativeUrl` — full member list of
 *   a specific cluster, returned as 404 when no cluster matches the
 *   representative (e.g. after a follow-up crawl collapsed the cluster
 *   via crawled-wins downgrade).
 *
 * The `:representativeUrl` segment is URL-encoded per RFC 3986 (the
 * cluster representative is a full https URL). Hono's path param decoding
 * handles the unescaping automatically.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerIsolatedClustersRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/isolated-clusters', async (c) => {
		const accessor = context.manager.get(context.archiveId);
		const result = await listIsolatedClusters(accessor, {
			limit: toNumber(c.req.query('limit')),
			offset: toNumber(c.req.query('offset')),
		});
		return c.json(result);
	});

	app.get('/api/isolated-clusters/:representativeUrl', async (c) => {
		const accessor = context.manager.get(context.archiveId);
		const representativeUrl = c.req.param('representativeUrl');
		const result = await getIsolatedCluster(accessor, representativeUrl);
		if (result === null) {
			return c.json(
				{
					error:
						'Isolated cluster not found for the supplied representativeUrl. It may have been collapsed by a follow-up crawl.',
				},
				404,
			);
		}
		return c.json(result);
	});
}
