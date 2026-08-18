import type { ArchiveContext } from '../types.js';
import type {
	CursorPaginatedPageList,
	ListPagesOptions,
	ListViewerPagesOptions,
} from '@nitpicker/query';
import type { Hono } from 'hono';

import { isViewerReadModelCurrent, listPages, listViewerPages } from '@nitpicker/query';

import { buildLivePagesCursors } from '../query-params/build-live-pages-cursors.js';
import { parseLivePagesCursor } from '../query-params/parse-live-pages-cursor.js';
import { toBoolean } from '../query-params/to-boolean.js';
import { toContentTypeCategory } from '../query-params/to-content-type-category.js';
import { toMultiValue } from '../query-params/to-multi-value.js';
import { toNumber } from '../query-params/to-number.js';
import { toPageSortBy } from '../query-params/to-page-sort-by.js';
import { toPageSortOrder } from '../query-params/to-page-sort-order.js';
import { toPageSource } from '../query-params/to-page-source.js';
import { refuseIfStaleReadModel } from '../refuse-if-stale-read-model.js';

/** Default page size, matching `listPages`/`listViewerPages`'s own default. */
const DEFAULT_LIMIT = 100;

/**
 * Registers `GET /api/pages` — paginated, filterable, sortable page list.
 *
 * Dispatches to one of three outcomes per request:
 *
 * - `listViewerPages` (the `viewer_pages` read-model fast path) whenever
 *   the read model is built and current. Every `/api/pages` filter is
 *   fast-path-capable: `templateKey` resolves via a narrow `page_id`-PK
 *   join to `page_templates`; `directory` is a `path_sort_key` range scan;
 *   `urlPattern` LIKEs the inlined `url` column plus the
 *   redirect-source/alias-member equivalence arms (search parity with
 *   `listPages` — see `ListViewerPagesOptions.urlPattern`); `lang` and the
 *   header-presence flags (`hasCSP` etc.) read dedicated `viewer_pages`
 *   columns copied at build time; `dedupeCapEventId` reads the dedicated
 *   `viewer_pages.dedupe_cap_event_id` column copied at build time.
 * - a {@link ReadModelUnavailable} response (`shouldRefuseStaleReadModel`)
 *   when the read model is missing/stale outside stub mode: silently
 *   falling through to `listPages` instead would be 10-50x+ slower on a
 *   large archive (see ARCHITECTURE.md's fast-path invariant) and would
 *   give no signal that re-running `viewer-build` would fix it.
 * - `listPages` (the live, offset-only, write-model path) in stub mode
 *   only (a live crawl, where the read model cannot exist yet).
 *   Its `cursor` is a plain decimal offset string (see
 *   `buildLivePagesCursors`), not the fast path's opaque keyset token, but
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

		const isReadModelCurrent = await isViewerReadModelCurrent(accessor);
		if (isReadModelCurrent) {
			const options: ListViewerPagesOptions = {
				isExternal: toMultiValue(c.req.queries('isExternal'), toBoolean),
				contentTypeCategory: toMultiValue(
					c.req.queries('contentTypeCategory'),
					toContentTypeCategory,
				),
				status: toMultiValue(c.req.queries('status'), toNumber),
				statusMin: toNumber(q.statusMin),
				statusMax: toNumber(q.statusMax),
				missingTitle: toMultiValue(c.req.queries('missingTitle'), toBoolean),
				missingDescription: toBoolean(q.missingDescription),
				noindex: toBoolean(q.noindex),
				lang: toMultiValue(c.req.queries('lang'), (value) => value || undefined),
				hasCSP: toMultiValue(c.req.queries('hasCSP'), toBoolean),
				hasXFrameOptions: toMultiValue(c.req.queries('hasXFrameOptions'), toBoolean),
				hasXContentTypeOptions: toMultiValue(
					c.req.queries('hasXContentTypeOptions'),
					toBoolean,
				),
				hasHSTS: toMultiValue(c.req.queries('hasHSTS'), toBoolean),
				isDedupeCapped: toMultiValue(c.req.queries('isDedupeCapped'), toBoolean),
				dedupeCapEventId: toNumber(q.dedupeCapEventId),
				source: toPageSource(q.source),
				templateKey: c.req.queries('templateKey'),
				directory: q.directory || undefined,
				urlPattern: q.urlPattern || undefined,
				sortBy: toPageSortBy(q.sortBy),
				sortOrder: toPageSortOrder(q.sortOrder),
				limit: toNumber(q.limit),
				cursor: q.cursor || undefined,
				direction: q.direction === 'prev' ? 'prev' : undefined,
				offset: toNumber(q.offset),
			};
			return c.json(await listViewerPages(accessor, options));
		}

		// No filter forces a live fallback for /api/pages — the only way to
		// reach here is a stale/missing read model (or stub mode, which
		// refuseIfStaleReadModel lets through to the live path below).
		const refused = refuseIfStaleReadModel(c, context.mode, isReadModelCurrent);
		if (refused) {
			return refused;
		}

		const limit = toNumber(q.limit) ?? DEFAULT_LIMIT;
		const offset = parseLivePagesCursor(q.cursor, toNumber(q.offset) ?? 0);
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
			isDedupeCapped: toBoolean(q.isDedupeCapped),
			dedupeCapEventId: toNumber(q.dedupeCapEventId),
			urlPattern: q.urlPattern,
			directory: q.directory,
			templateKey: q.templateKey,
			sortBy: toPageSortBy(q.sortBy),
			sortOrder: toPageSortOrder(q.sortOrder),
			limit,
			offset,
			// Issue #294: a cold connection's first `sortBy: 'url'` (the
			// default) request lazily builds the URL natural-sort TEMP
			// table, which can take a while on a large archive with no
			// other signal it isn't hung.
			// eslint-disable-next-line no-console
			onSortProgress: (message) => console.error(message),
		};
		const liveResult = await listPages(accessor, options);
		const { nextCursor, prevCursor } = buildLivePagesCursors({
			offset,
			itemCount: liveResult.items.length,
			total: liveResult.total,
			limit: liveResult.limit,
		});
		const result: CursorPaginatedPageList = { ...liveResult, nextCursor, prevCursor };
		return c.json(result);
	});
}
