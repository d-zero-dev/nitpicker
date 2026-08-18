import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import {
	isViewerReadModelCurrent,
	listExternalLinks,
	listLinks,
	listViewerBrokenLinks,
	listViewerExternalLinks,
	resolveLiveFilterValue,
} from '@nitpicker/query';

import { buildLivePagesCursors } from '../query-params/build-live-pages-cursors.js';
import { parseLivePagesCursor } from '../query-params/parse-live-pages-cursor.js';
import { toMultiValue } from '../query-params/to-multi-value.js';
import { toNumber } from '../query-params/to-number.js';
import { refuseIfStaleReadModel } from '../refuse-if-stale-read-model.js';

/** Valid `type` values for the links route. */
const VALID_LINK_TYPES = ['broken', 'external'] as const;

/** Default page size, matching `listLinks`/`listViewerBrokenLinks`'s own default. */
const DEFAULT_LIMIT = 100;

/**
 * `sortBy` values `listViewerBrokenLinks` supports — a strict subset of
 * `listLinks`'s 5 (`sourceUrl`/`destUrl`/`status`/`isExternal`/
 * `textContent`): `viewer_anchor_facts` stores no anchor text at all (see
 * `list-viewer-broken-links.ts`'s docs), so a `textContent` request must
 * force the live fallback rather than silently falling through
 * `getAnchorFactsSortSpec`'s `sourceUrl` default — a bookmarked/shared
 * `?sortBy=textContent` URL must sort the same way whether or not the read
 * model happens to be current, not silently change order depending on
 * internal cache state.
 */
const BROKEN_LINKS_FAST_PATH_SORT_KEYS = new Set([
	'sourceUrl',
	'destUrl',
	'status',
	'isExternal',
]);

/**
 * Registers `GET /api/links?type=broken|external` — link analysis.
 *
 * There is no `orphaned` type: completely isolated inventory-* pages are
 * reported by `/api/isolated-pages`, and interconnected orphan clusters by
 * `/api/isolated-clusters`. `broken` is anchor-level (one row per `<a>`
 * tag, resolved through `pages.redirectDestId` to the canonical final
 * destination unless `includeRedirectSources=true`) via `listLinks`.
 * `external` is deduplicated by canonical destination — one row per unique
 * destination with a `referrerCount` — so its response shape and query
 * params differ (no `includeRedirectSources`, no
 * `sourceUrl`/`isExternal`/`textContent` sort keys, an added
 * `referrerCount` sort key).
 *
 * Both `external` and `broken` dispatch to one of two backends per request,
 * the same two-layer pattern `register-pages-route.ts` uses for
 * `/api/pages`:
 *
 * - `external`: `listViewerExternalLinks` (the `viewer_external_links`
 *   read-model fast path) when the read model is current — no filter forces
 *   a live fallback here, since `urlPattern`/`status` both map directly
 *   onto `viewer_external_links` columns. Otherwise `listExternalLinks`
 *   (the live `anchors` JOIN + `GROUP BY` query).
 * - `broken`: `listViewerBrokenLinks` (the `viewer_anchor_facts` read-model
 *   fast path, cursor-paginated) when the read model is current AND neither
 *   `includeRedirectSources` nor an unsupported `sortBy`
 *   (`isExternal`/`textContent` — see `BROKEN_LINKS_FAST_PATH_SORT_KEYS`) is
 *   set — `includeRedirectSources` has no read-model equivalent
 *   (`viewer_anchor_facts` only ever stores the canonical destination); and
 *   the fast path's narrower `sortBy` union means an unsupported value must
 *   force the live fallback rather than silently resolving to a different
 *   sort. `urlPattern` takes the fast path (a source/dest OR'd LIKE over
 *   two 1:1 `viewer_url_refs` joins — see
 *   `ListViewerBrokenLinksOptions.urlPattern`). Otherwise `listLinks`
 *   (live, anchor-scan-bound, offset-based). The
 *   live path's `cursor` is a plain decimal offset string (see
 *   `buildLivePagesCursors`), not the fast path's opaque keyset token, but
 *   exposes the same `nextCursor`-only contract so `useLinksInfinite`'s
 *   virtual scroll keeps paginating past the first page regardless of which
 *   backend served it.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerLinksRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/links', async (c) => {
		const q = c.req.query();
		const type = q.type;
		if (!type || !(VALID_LINK_TYPES as readonly string[]).includes(type)) {
			return c.json(
				{
					error: `Invalid or missing type. Must be one of: ${VALID_LINK_TYPES.join(', ')}`,
				},
				400,
			);
		}
		const accessor = context.manager.get(context.archiveId);
		const limit = toNumber(q.limit);
		const offset = toNumber(q.offset);
		const urlPattern = q.urlPattern;
		const status = toMultiValue(c.req.queries('status'), toNumber);
		const sortOrder = q.sortOrder as 'asc' | 'desc' | undefined;

		if (type === 'external') {
			const sortBy = q.sortBy as 'destUrl' | 'status' | 'referrerCount' | undefined;
			const isReadModelCurrent = await isViewerReadModelCurrent(accessor);
			if (isReadModelCurrent) {
				return c.json(
					await listViewerExternalLinks(accessor, {
						limit,
						offset,
						urlPattern,
						status,
						sortBy,
						sortOrder,
					}),
				);
			}
			// No filter forces a live fallback for `external` — the only
			// reason to reach here is a stale/missing read model.
			const refused = refuseIfStaleReadModel(c, context.mode, isReadModelCurrent);
			if (refused) {
				return refused;
			}
			return c.json(
				await listExternalLinks(accessor, {
					limit,
					offset,
					urlPattern,
					status: resolveLiveFilterValue(status),
					sortBy,
					sortOrder,
					// Issue #294: a cold connection's first URL-typed sort
					// lazily builds the URL natural-sort TEMP table, which
					// can take a while on a large archive with no other
					// signal it isn't hung.
					// eslint-disable-next-line no-console
					onSortProgress: (message) => console.error(message),
				}),
			);
		}

		const includeRedirectSources = q.includeRedirectSources === 'true';
		const usesUnsupportedSort = Boolean(
			q.sortBy && !BROKEN_LINKS_FAST_PATH_SORT_KEYS.has(q.sortBy),
		);
		const usesWideTableOnlyFilter = Boolean(
			includeRedirectSources || usesUnsupportedSort,
		);
		const isReadModelCurrent = await isViewerReadModelCurrent(accessor);
		if (!usesWideTableOnlyFilter && isReadModelCurrent) {
			const result = await listViewerBrokenLinks(accessor, {
				limit,
				offset,
				status,
				urlPattern,
				sortBy: q.sortBy as 'sourceUrl' | 'destUrl' | 'status' | 'isExternal' | undefined,
				sortOrder,
				cursor: q.cursor || undefined,
				direction: q.direction === 'prev' ? 'prev' : undefined,
			});
			return c.json(result);
		}

		// `includeRedirectSources`/unsupported-sort are permanently live
		// (structural — see ARCHITECTURE.md's `includeRedirectSources`
		// invariant), so only refuse when the fast path *would* have served
		// this request had the read model been current.
		if (!usesWideTableOnlyFilter) {
			const refused = refuseIfStaleReadModel(c, context.mode, isReadModelCurrent);
			if (refused) {
				return refused;
			}
		}

		const liveLimit = limit ?? DEFAULT_LIMIT;
		const liveOffset = parseLivePagesCursor(q.cursor, offset ?? 0);
		const liveResult = await listLinks(accessor, {
			type: 'broken',
			limit: liveLimit,
			offset: liveOffset,
			includeRedirectSources,
			urlPattern,
			status: resolveLiveFilterValue(status),
			sortBy: q.sortBy as
				| 'sourceUrl'
				| 'destUrl'
				| 'status'
				| 'isExternal'
				| 'textContent'
				| undefined,
			sortOrder,
			// Issue #294: a cold connection's first URL-typed sort lazily
			// builds the URL natural-sort TEMP table, which can take a while
			// on a large archive with no other signal it isn't hung.
			// eslint-disable-next-line no-console
			onSortProgress: (message) => console.error(message),
		});
		const { nextCursor, prevCursor } = buildLivePagesCursors({
			offset: liveOffset,
			itemCount: liveResult.items.length,
			total: liveResult.total,
			limit: liveLimit,
		});
		return c.json({ ...liveResult, nextCursor, prevCursor });
	});
}
