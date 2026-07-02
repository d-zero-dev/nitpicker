import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { getIsolatedCluster, listIsolatedClusters } from '@nitpicker/query';

import { getCachedIsolatedClusters } from '../isolated-clusters-cache.js';
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
		const precomputedComponents = await getCachedIsolatedClusters(context);
		const result = await listIsolatedClusters(accessor, {
			urlPattern: c.req.query('urlPattern'),
			status: toNumber(c.req.query('status')),
			sortBy: c.req.query('sortBy') as
				| 'representativeUrl'
				| 'representativeTitle'
				| 'representativeStatus'
				| 'size'
				| undefined,
			sortOrder: c.req.query('sortOrder') as 'asc' | 'desc' | undefined,
			limit: toNumber(c.req.query('limit')),
			offset: toNumber(c.req.query('offset')),
			precomputedComponents,
		});
		return c.json(result);
	});

	app.get('/api/isolated-clusters/:representativeUrl', async (c) => {
		const accessor = context.manager.get(context.archiveId);
		const representativeUrl = c.req.param('representativeUrl');
		const precomputedComponents = await getCachedIsolatedClusters(context);
		const result = await getIsolatedCluster(accessor, representativeUrl, {
			urlPattern: c.req.query('urlPattern'),
			status: toNumber(c.req.query('status')),
			source: c.req.query('source') as
				| 'crawled'
				| 'inventory-seed'
				| 'inventory-discovered'
				| undefined,
			sortBy: c.req.query('sortBy') as 'url' | 'title' | 'status' | 'source' | undefined,
			sortOrder: c.req.query('sortOrder') as 'asc' | 'desc' | undefined,
			limit: toNumber(c.req.query('limit')),
			offset: toNumber(c.req.query('offset')),
			precomputedComponents,
		});
		if (result === null) {
			// Distinguish "the URL maps to a singleton, you wanted
			// /api/isolated-pages" from "the cluster collapsed". Deep-
			// linking a singleton URL into the clusters surface is a
			// realistic operator error (e.g. teammates sharing URLs
			// between the two tables); merging both into the same 404
			// "collapsed by follow-up crawl" message has been a
			// recurring source of confused diff-the-archive triage.
			const isSingleton = precomputedComponents.some(
				(component) =>
					component.representativeUrl === representativeUrl && component.size === 1,
			);
			if (isSingleton) {
				return c.json(
					{
						error:
							'This URL identifies a singleton (size 1) in the inventory subgraph — use /api/isolated-pages to view it. The isolated-clusters surface only lists components with size ≥ 2.',
					},
					404,
				);
			}
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
