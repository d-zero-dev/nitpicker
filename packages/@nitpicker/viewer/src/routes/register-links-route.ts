import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import {
	isViewerReadModelCurrent,
	listExternalLinks,
	listLinks,
	listViewerBrokenLinks,
	listViewerExternalLinks,
} from '@nitpicker/query';

import { buildLegacyPagesCursors } from '../query-params/build-legacy-pages-cursors.js';
import { parseLegacyPagesCursor } from '../query-params/parse-legacy-pages-cursor.js';
import { toNumber } from '../query-params/to-number.js';

/** Valid `type` values for the links route. */
const VALID_LINK_TYPES = ['broken', 'external'] as const;

/** Default page size, matching `listLinks`/`listViewerBrokenLinks`'s own default. */
const DEFAULT_LIMIT = 100;

/**
 * `sortBy` values `listViewerBrokenLinks` supports — a strict subset of
 * `listLinks`'s 5 (`sourceUrl`/`destUrl`/`status`/`isExternal`/
 * `textContent`), since `viewer_anchor_facts` has no index on
 * `is_external_link` and stores no anchor text at all (see
 * `list-viewer-broken-links.ts`'s docs). A request for `isExternal`/
 * `textContent` must force the legacy fallback rather than silently
 * falling through `getAnchorFactsSortSpec`'s `sourceUrl` default — a
 * bookmarked/shared `?sortBy=isExternal` URL must sort the same way
 * whether or not the read model happens to be current, not silently
 * change order depending on internal cache state.
 */
const BROKEN_LINKS_FAST_PATH_SORT_KEYS = new Set(['sourceUrl', 'destUrl', 'status']);

/**
 * Registers `GET /api/links?type=broken|external` — link analysis.
 *
 * `orphaned` was retired: completely isolated inventory-* pages are reported
 * by `/api/isolated-pages`, and interconnected orphan clusters by
 * `/api/isolated-clusters`. `broken` stays anchor-level (one row per `<a>`
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
 *   a legacy fallback here, since `urlPattern`/`status` both map directly
 *   onto `viewer_external_links` columns. Otherwise `listExternalLinks`
 *   (the legacy live `anchors` JOIN + `GROUP BY` query).
 * - `broken`: `listViewerBrokenLinks` (the `viewer_anchor_facts` read-model
 *   fast path, cursor-paginated) when the read model is current AND none of
 *   `urlPattern`, `includeRedirectSources`, or an unsupported `sortBy`
 *   (`isExternal`/`textContent` — see `BROKEN_LINKS_FAST_PATH_SORT_KEYS`) is
 *   set — `urlPattern` matches source OR destination across two columns,
 *   which no single index can satisfy; `includeRedirectSources` has no
 *   read-model equivalent (`viewer_anchor_facts` only ever stores the
 *   canonical destination); and the fast path's narrower `sortBy` union
 *   means an unsupported value must force the legacy fallback rather than
 *   silently resolving to a different sort. Otherwise `listLinks` (legacy,
 *   anchor-scan-bound, offset-based). The
 *   legacy path's `cursor` is a plain decimal offset string (see
 *   `buildLegacyPagesCursors`), not the fast path's opaque keyset token, but
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
		const status = toNumber(q.status);
		const sortOrder = q.sortOrder as 'asc' | 'desc' | undefined;

		if (type === 'external') {
			const params = {
				limit,
				offset,
				urlPattern,
				status,
				sortBy: q.sortBy as 'destUrl' | 'status' | 'referrerCount' | undefined,
				sortOrder,
			};
			const result = (await isViewerReadModelCurrent(accessor))
				? await listViewerExternalLinks(accessor, params)
				: await listExternalLinks(accessor, params);
			return c.json(result);
		}

		const includeRedirectSources = q.includeRedirectSources === 'true';
		const usesUnsupportedSort = Boolean(
			q.sortBy && !BROKEN_LINKS_FAST_PATH_SORT_KEYS.has(q.sortBy),
		);
		const usesWideTableOnlyFilter = Boolean(
			urlPattern || includeRedirectSources || usesUnsupportedSort,
		);
		if (!usesWideTableOnlyFilter && (await isViewerReadModelCurrent(accessor))) {
			const result = await listViewerBrokenLinks(accessor, {
				limit,
				offset,
				status,
				sortBy: q.sortBy as 'sourceUrl' | 'destUrl' | 'status' | undefined,
				sortOrder,
				cursor: q.cursor || undefined,
				direction: q.direction === 'prev' ? 'prev' : undefined,
			});
			return c.json(result);
		}

		const legacyLimit = limit ?? DEFAULT_LIMIT;
		const legacyOffset = parseLegacyPagesCursor(q.cursor, offset ?? 0);
		const legacyResult = await listLinks(accessor, {
			type: 'broken',
			limit: legacyLimit,
			offset: legacyOffset,
			includeRedirectSources,
			urlPattern,
			status,
			sortBy: q.sortBy as
				| 'sourceUrl'
				| 'destUrl'
				| 'status'
				| 'isExternal'
				| 'textContent'
				| undefined,
			sortOrder,
		});
		const { nextCursor, prevCursor } = buildLegacyPagesCursors({
			offset: legacyOffset,
			itemCount: legacyResult.items.length,
			total: legacyResult.total,
			limit: legacyLimit,
		});
		return c.json({ ...legacyResult, nextCursor, prevCursor });
	});
}
