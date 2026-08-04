import type { ArchiveContext } from '../types.js';
import type {
	CursorPaginatedUnusedResourceList,
	ListUnusedResourcesOptions,
	ListViewerUnusedResourcesOptions,
} from '@nitpicker/query';
import type { Hono } from 'hono';

import {
	isViewerReadModelCurrent,
	listUnusedResources,
	listViewerUnusedResources,
} from '@nitpicker/query';

import { buildLivePagesCursors } from '../query-params/build-live-pages-cursors.js';
import { parseLivePagesCursor } from '../query-params/parse-live-pages-cursor.js';
import { toMultiValue } from '../query-params/to-multi-value.js';
import { toNumber } from '../query-params/to-number.js';
import { toPageSortOrder } from '../query-params/to-page-sort-order.js';
import { toPageSource } from '../query-params/to-page-source.js';
import { toUnusedResourcesSortBy } from '../query-params/to-unused-resources-sort-by.js';
import { refuseIfStaleReadModel } from '../refuse-if-stale-read-model.js';

/** Default page size, matching `listUnusedResources`/`listViewerUnusedResources`'s own default. */
const DEFAULT_LIMIT = 100;

/**
 * Registers `GET /api/unused-resources` — internal sub-resources that no
 * archived page references. Used by the viewer's "unused file" surface to
 * highlight candidates for deletion from the server.
 *
 * Dispatches to one of two backends per request, same two-way split as
 * `registerPagesRoute`/`registerResourcesRoute`:
 *
 * - `listViewerUnusedResources` (the pre-filtered `is_unused = 1` subset of
 *   the `viewer_resources` read-model fast path) when the read model is
 *   current AND the request uses none of the filters/sorts only the wide
 *   `resources` table can evaluate: the LIKE-based `urlPattern`, the
 *   raw-MIME-prefix `contentType`, and any `sortBy` outside
 *   `url`/`status`/`source`.
 * - `listUnusedResources` (the live, offset-only,
 *   request-time-anti-join path) otherwise.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerUnusedResourcesRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/unused-resources', async (c) => {
		const q = c.req.query();
		const accessor = context.manager.get(context.archiveId);

		const isReadModelCurrent = await isViewerReadModelCurrent(accessor);
		if (isReadModelCurrent) {
			const options: ListViewerUnusedResourcesOptions = {
				status: toMultiValue(c.req.queries('status'), toNumber),
				source: toMultiValue(c.req.queries('source'), toPageSource),
				urlPattern: q.urlPattern || undefined,
				contentType: q.contentType || undefined,
				sortBy: toUnusedResourcesSortBy(q.sortBy),
				sortOrder: toPageSortOrder(q.sortOrder),
				limit: toNumber(q.limit),
				cursor: q.cursor || undefined,
				direction: q.direction === 'prev' ? 'prev' : undefined,
				offset: toNumber(q.offset),
			};
			return c.json(await listViewerUnusedResources(accessor, options));
		}

		// No filter forces a live fallback for /api/unused-resources — the
		// only way to reach here is a stale/missing read model (or stub mode,
		// which refuseIfStaleReadModel lets through to live below).
		const refused = refuseIfStaleReadModel(c, context.mode, isReadModelCurrent);
		if (refused) {
			return refused;
		}

		const limit = toNumber(q.limit) ?? DEFAULT_LIMIT;
		const offset = parseLivePagesCursor(q.cursor, toNumber(q.offset) ?? 0);
		const options: ListUnusedResourcesOptions = {
			urlPattern: q.urlPattern,
			status: toNumber(q.status),
			contentType: q.contentType,
			source: toPageSource(q.source),
			sortBy: q.sortBy as ListUnusedResourcesOptions['sortBy'],
			sortOrder: q.sortOrder as ListUnusedResourcesOptions['sortOrder'],
			limit,
			offset,
		};
		const liveResult = await listUnusedResources(accessor, options);
		const { nextCursor, prevCursor } = buildLivePagesCursors({
			offset,
			itemCount: liveResult.items.length,
			total: liveResult.total,
			limit,
		});
		const result: CursorPaginatedUnusedResourceList = {
			...liveResult,
			nextCursor,
			prevCursor,
		};
		return c.json(result);
	});
}
