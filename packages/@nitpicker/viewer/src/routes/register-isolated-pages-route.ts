import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import {
	isViewerReadModelCurrent,
	listIsolatedPages,
	listIsolatedPagesFastPath,
	resolveLiveFilterValue,
} from '@nitpicker/query';

import { getCachedIsolatedClusters } from '../isolated-clusters-cache.js';
import { toMultiValue } from '../query-params/to-multi-value.js';
import { toNumber } from '../query-params/to-number.js';
import { toPageSource } from '../query-params/to-page-source.js';
import { refuseIfStaleReadModel } from '../refuse-if-stale-read-model.js';

/**
 * Registers `GET /api/isolated-pages` — internal HTML pages with no
 * inbound anchors, excluding archived roots. Used by the viewer's
 * "orphan LP" surface to highlight pages that the recursive crawl
 * could not reach via the link graph.
 *
 * Shares the per-archive `IsolatedComponent[]` cache with the
 * `/api/isolated-clusters` endpoints — the union-find pass runs once
 * per archive, all three endpoints filter from the same result.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerIsolatedPagesRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/isolated-pages', async (c) => {
		const accessor = context.manager.get(context.archiveId);
		const status = toMultiValue(c.req.queries('status'), toNumber);
		const source = toMultiValue(c.req.queries('source'), toPageSource);
		const sharedOptions = {
			urlPattern: c.req.query('urlPattern'),
			sortBy: c.req.query('sortBy') as 'url' | 'title' | 'status' | 'source' | undefined,
			sortOrder: c.req.query('sortOrder') as 'asc' | 'desc' | undefined,
			limit: toNumber(c.req.query('limit')),
			offset: toNumber(c.req.query('offset')),
		};
		// `listIsolatedPagesFastPath` has no forced-live filter of its own —
		// its only live fallback reason is a stale/missing read model, and
		// that live branch has no `precomputedComponents` cache to reuse,
		// re-running the full union-find pass per request. Refuse instead of
		// paying that cost silently.
		const isReadModelCurrent = await isViewerReadModelCurrent(accessor);
		const refused = refuseIfStaleReadModel(c, context.mode, isReadModelCurrent);
		if (refused) {
			return refused;
		}

		const result =
			context.mode === 'stub'
				? await listIsolatedPages(accessor, {
						...sharedOptions,
						status: resolveLiveFilterValue(status),
						source: resolveLiveFilterValue(source),
						precomputedComponents: await getCachedIsolatedClusters(context),
					})
				: await listIsolatedPagesFastPath(
						accessor,
						{ ...sharedOptions, status, source },
						isReadModelCurrent,
					);
		return c.json(result);
	});
}
