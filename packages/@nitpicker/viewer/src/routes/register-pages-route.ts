import type { ArchiveContext } from '../types.js';
import type {
	CursorPaginatedPageList,
	ListPagesOptions,
	ListViewerPagesOptions,
} from '@nitpicker/query';
import type { Hono } from 'hono';

import { isViewerReadModelCurrent, listPages, listViewerPages } from '@nitpicker/query';

import { buildLegacyPagesCursors } from '../query-params/build-legacy-pages-cursors.js';
import { parseLegacyPagesCursor } from '../query-params/parse-legacy-pages-cursor.js';
import { toBoolean } from '../query-params/to-boolean.js';
import { toContentTypeCategory } from '../query-params/to-content-type-category.js';
import { toNumber } from '../query-params/to-number.js';
import { toPageSortBy } from '../query-params/to-page-sort-by.js';
import { toPageSortOrder } from '../query-params/to-page-sort-order.js';
import { toPageSource } from '../query-params/to-page-source.js';

/** Default page size, matching `listPages`/`listViewerPages`'s own default. */
const DEFAULT_LIMIT = 100;

/**
 * Registers `GET /api/pages` — paginated, filterable, sortable page list.
 *
 * Dispatches to one of two backends per request:
 *
 * - `listViewerPages` (the `viewer_pages` read-model fast path) when the
 *   read model is built and current AND the request uses none of the
 *   filters that only the wide `pages` table can evaluate: the LIKE-based
 *   `urlPattern` (a substring LIKE predicate can't seek an index, so it is
 *   deliberately excluded from the fast path), and the header-presence
 *   filters (`hasCSP` / `hasXFrameOptions` / `hasXContentTypeOptions` /
 *   `hasHSTS`) computed from `pages.responseHeaders` — `viewer_pages` has no
 *   equivalent column, and evaluating them only after the narrow-table
 *   id-limiting stage would corrupt `total`/pagination. `templateKey` does
 *   NOT force this fallback: `listViewerPages` resolves it via a narrow
 *   `page_id`-PK join to `page_templates`, not a wide-table scan. `directory`
 *   DOES take the fast path too — see `ListViewerPagesOptions.directory`'s
 *   docs for why a prefix range scan stays within its contract unlike
 *   `urlPattern`.
 * - `listPages` (the legacy, offset-only, write-model path) otherwise —
 *   covers archives predating the read model (issue #112's build-timing
 *   work is tracked separately) and the excluded-filter cases above. Its
 *   `cursor` is a plain decimal offset string (see
 *   `buildLegacyPagesCursors`), not the fast path's opaque keyset token, but
 *   exposes the same `nextCursor`-only contract so `usePagesInfinite`'s
 *   virtual scroll keeps paginating past the first page regardless of which
 *   backend served it.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerPagesRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/pages', async (c) => {
		const q = c.req.query();
		const accessor = context.manager.get(context.archiveId);

		const usesWideTableOnlyFilter = Boolean(
			q.urlPattern ||
			q.hasCSP ||
			q.hasXFrameOptions ||
			q.hasXContentTypeOptions ||
			q.hasHSTS,
		);
		if (!usesWideTableOnlyFilter && (await isViewerReadModelCurrent(accessor))) {
			const options: ListViewerPagesOptions = {
				isExternal: toBoolean(q.isExternal),
				contentTypeCategory: toContentTypeCategory(q.contentTypeCategory),
				status: toNumber(q.status),
				statusMin: toNumber(q.statusMin),
				statusMax: toNumber(q.statusMax),
				missingTitle: toBoolean(q.missingTitle),
				missingDescription: toBoolean(q.missingDescription),
				noindex: toBoolean(q.noindex),
				source: toPageSource(q.source),
				templateKey: q.templateKey,
				directory: q.directory || undefined,
				sortBy: toPageSortBy(q.sortBy),
				sortOrder: toPageSortOrder(q.sortOrder),
				limit: toNumber(q.limit),
				cursor: q.cursor || undefined,
				direction: q.direction === 'prev' ? 'prev' : undefined,
				offset: toNumber(q.offset),
			};
			return c.json(await listViewerPages(accessor, options));
		}

		const limit = toNumber(q.limit) ?? DEFAULT_LIMIT;
		const offset = parseLegacyPagesCursor(q.cursor, toNumber(q.offset) ?? 0);
		const options: ListPagesOptions = {
			status: toNumber(q.status),
			statusMin: toNumber(q.statusMin),
			statusMax: toNumber(q.statusMax),
			isExternal: toBoolean(q.isExternal),
			lang: q.lang,
			contentTypeCategory: toContentTypeCategory(q.contentTypeCategory),
			missingTitle: toBoolean(q.missingTitle),
			missingDescription: toBoolean(q.missingDescription),
			noindex: toBoolean(q.noindex),
			hasCSP: toBoolean(q.hasCSP),
			hasXFrameOptions: toBoolean(q.hasXFrameOptions),
			hasXContentTypeOptions: toBoolean(q.hasXContentTypeOptions),
			hasHSTS: toBoolean(q.hasHSTS),
			urlPattern: q.urlPattern,
			directory: q.directory,
			templateKey: q.templateKey,
			sortBy: toPageSortBy(q.sortBy),
			sortOrder: toPageSortOrder(q.sortOrder),
			limit,
			offset,
		};
		const legacyResult = await listPages(accessor, options);
		const { nextCursor, prevCursor } = buildLegacyPagesCursors({
			offset,
			itemCount: legacyResult.items.length,
			total: legacyResult.total,
			limit: legacyResult.limit,
		});
		const result: CursorPaginatedPageList = { ...legacyResult, nextCursor, prevCursor };
		return c.json(result);
	});
}
