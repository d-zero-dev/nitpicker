import type { ArchiveContext } from '../types.js';
import type { CheckHeadersOptions } from '@nitpicker/query';
import type { Hono } from 'hono';

import { getHeaderChecksFastPath, isViewerReadModelCurrent } from '@nitpicker/query';

import { toBoolean } from '../query-params/to-boolean.js';
import { toHeaderChecksSortBy } from '../query-params/to-header-checks-sort-by.js';
import { toNumber } from '../query-params/to-number.js';
import { toPageSortOrder } from '../query-params/to-page-sort-order.js';
import { refuseIfStaleReadModel } from '../refuse-if-stale-read-model.js';

/**
 * Registers `GET /api/headers` — paginated, filterable security-header check
 * list (issue #119).
 *
 * Dispatches through `getHeaderChecksFastPath`, the same helper the CLI
 * `query headers` sub-command and MCP `check_headers` tool use:
 * `viewer_header_checks` (the read-model fast path) when current and
 * `sortBy` is `'url'` or unset, else the live `checkHeaders` write-model
 * path. Always returns a `CursorPaginatedHeaderCheckList` (with
 * `nextCursor`/`prevCursor` both `null` on the live branch), matching
 * `registerImagesRoute`'s response-shape contract.
 *
 * `cursor`/`direction` are read from the query string and forwarded
 * verbatim — this is the only production entry point that ever sets them
 * (CLI/MCP callers only ever pass `offset`), the same convention
 * `registerImagesRoute` documents for its own route.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerHeaderChecksRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/headers', async (c) => {
		const q = c.req.query();
		const accessor = context.manager.get(context.archiveId);
		const options: CheckHeadersOptions = {
			missingOnly: toBoolean(q.missingOnly),
			hasCSP: toBoolean(q.hasCSP),
			hasXFrameOptions: toBoolean(q.hasXFrameOptions),
			hasXContentTypeOptions: toBoolean(q.hasXContentTypeOptions),
			hasHSTS: toBoolean(q.hasHSTS),
			// Allowlist-narrowed, never an unvalidated cast: an unknown value
			// would flow into getHeaderChecksSortSpec's column lookup and
			// crash the request with an opaque 500 (see toHeaderChecksSortBy).
			sortBy: toHeaderChecksSortBy(q.sortBy),
			sortOrder: toPageSortOrder(q.sortOrder),
			limit: toNumber(q.limit),
			offset: toNumber(q.offset),
			cursor: q.cursor || undefined,
			direction: q.direction === 'prev' ? 'prev' : undefined,
		};

		// No filter forces a live fallback for /api/headers (see
		// getHeaderChecksFastPath's docs) — the only reason that function
		// degrades to live is a stale/missing read model, which this gate
		// turns into an actionable response instead. Decided here, one level
		// above the shared CLI/MCP/viewer fast-path helper, so those
		// non-interactive callers keep silently degrading.
		const isReadModelCurrent = await isViewerReadModelCurrent(accessor);
		const refused = refuseIfStaleReadModel(c, context.mode, isReadModelCurrent);
		if (refused) {
			return refused;
		}

		return c.json(await getHeaderChecksFastPath(accessor, options, isReadModelCurrent));
	});
}
