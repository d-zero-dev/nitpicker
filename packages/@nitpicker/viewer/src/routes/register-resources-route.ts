import type { ArchiveContext } from '../types.js';
import type {
	CursorPaginatedResourceList,
	ListResourcesOptions,
	ListViewerResourcesOptions,
} from '@nitpicker/query';
import type { Hono } from 'hono';

import {
	isViewerReadModelCurrent,
	listResources,
	listViewerResources,
} from '@nitpicker/query';

import { buildLegacyPagesCursors } from '../query-params/build-legacy-pages-cursors.js';
import { parseLegacyPagesCursor } from '../query-params/parse-legacy-pages-cursor.js';
import { toBoolean } from '../query-params/to-boolean.js';
import { toMultiValue } from '../query-params/to-multi-value.js';
import { toNumber } from '../query-params/to-number.js';
import { toPageSortOrder } from '../query-params/to-page-sort-order.js';
import { toResourcesSortBy } from '../query-params/to-resources-sort-by.js';

/** Default page size, matching `listResources`/`listViewerResources`'s own default. */
const DEFAULT_LIMIT = 100;

/**
 * Registers `GET /api/resources` — paginated, filterable resource list.
 *
 * Dispatches to one of two backends per request, same two-way split as
 * `registerPagesRoute`:
 *
 * - `listViewerResources` (the `viewer_resources` read-model fast path)
 *   when the read model is current AND the request uses none of the
 *   filters/sorts only the wide `resources` table can evaluate: the
 *   LIKE-based `urlPattern`, the raw-MIME-prefix `contentType` (the read
 *   model only stores the classified `content_category`), and any `sortBy`
 *   outside `url`/`status` (the read model indexes).
 * - `listResources` (the legacy, offset-only, write-model path) otherwise.
 *   Its `cursor` is a plain decimal offset string (see
 *   `buildLegacyPagesCursors`), not the fast path's opaque keyset token, but
 *   exposes the same `nextCursor`-only contract either backend can serve.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerResourcesRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/resources', async (c) => {
		const q = c.req.query();
		const accessor = context.manager.get(context.archiveId);

		const usesWideTableOnlyFilter = Boolean(
			q.urlPattern || q.contentType || (q.sortBy && !toResourcesSortBy(q.sortBy)),
		);
		if (!usesWideTableOnlyFilter && (await isViewerReadModelCurrent(accessor))) {
			const options: ListViewerResourcesOptions = {
				isExternal: toBoolean(q.isExternal),
				status: toMultiValue(c.req.queries('status'), toNumber),
				sortBy: toResourcesSortBy(q.sortBy),
				sortOrder: toPageSortOrder(q.sortOrder),
				limit: toNumber(q.limit),
				cursor: q.cursor || undefined,
				direction: q.direction === 'prev' ? 'prev' : undefined,
				offset: toNumber(q.offset),
			};
			return c.json(await listViewerResources(accessor, options));
		}

		const limit = toNumber(q.limit) ?? DEFAULT_LIMIT;
		const offset = parseLegacyPagesCursor(q.cursor, toNumber(q.offset) ?? 0);
		const options: ListResourcesOptions = {
			urlPattern: q.urlPattern,
			status: toNumber(q.status),
			contentType: q.contentType,
			isExternal: toBoolean(q.isExternal),
			sortBy: q.sortBy as ListResourcesOptions['sortBy'],
			sortOrder: q.sortOrder as ListResourcesOptions['sortOrder'],
			limit,
			offset,
		};
		const legacyResult = await listResources(accessor, options);
		const { nextCursor, prevCursor } = buildLegacyPagesCursors({
			offset,
			itemCount: legacyResult.items.length,
			total: legacyResult.total,
			limit: legacyResult.limit,
		});
		const result: CursorPaginatedResourceList = {
			...legacyResult,
			nextCursor,
			prevCursor,
		};
		return c.json(result);
	});
}
