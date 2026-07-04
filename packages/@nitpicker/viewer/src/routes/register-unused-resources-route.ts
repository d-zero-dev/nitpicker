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

import { buildLegacyPagesCursors } from '../query-params/build-legacy-pages-cursors.js';
import { parseLegacyPagesCursor } from '../query-params/parse-legacy-pages-cursor.js';
import { toNumber } from '../query-params/to-number.js';
import { toPageSortOrder } from '../query-params/to-page-sort-order.js';
import { toPageSource } from '../query-params/to-page-source.js';
import { toUnusedResourcesSortBy } from '../query-params/to-unused-resources-sort-by.js';

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
 * - `listUnusedResources` (the legacy, offset-only,
 *   request-time-anti-join path) otherwise.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerUnusedResourcesRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/unused-resources', async (c) => {
		const q = c.req.query();
		const accessor = context.manager.get(context.archiveId);

		const usesWideTableOnlyFilter = Boolean(
			q.urlPattern || q.contentType || (q.sortBy && !toUnusedResourcesSortBy(q.sortBy)),
		);
		if (!usesWideTableOnlyFilter && (await isViewerReadModelCurrent(accessor))) {
			const options: ListViewerUnusedResourcesOptions = {
				status: toNumber(q.status),
				source: toPageSource(q.source),
				sortBy: toUnusedResourcesSortBy(q.sortBy),
				sortOrder: toPageSortOrder(q.sortOrder),
				limit: toNumber(q.limit),
				cursor: q.cursor || undefined,
				direction: q.direction === 'prev' ? 'prev' : undefined,
				offset: toNumber(q.offset),
			};
			return c.json(await listViewerUnusedResources(accessor, options));
		}

		const limit = toNumber(q.limit) ?? DEFAULT_LIMIT;
		const offset = parseLegacyPagesCursor(q.cursor, toNumber(q.offset) ?? 0);
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
		const legacyResult = await listUnusedResources(accessor, options);
		const { nextCursor, prevCursor } = buildLegacyPagesCursors({
			offset,
			itemCount: legacyResult.items.length,
			total: legacyResult.total,
			limit,
		});
		const result: CursorPaginatedUnusedResourceList = {
			...legacyResult,
			nextCursor,
			prevCursor,
		};
		return c.json(result);
	});
}
