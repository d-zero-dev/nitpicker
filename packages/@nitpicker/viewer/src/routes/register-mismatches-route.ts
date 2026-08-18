import type { ArchiveContext } from '../types.js';
import type { FindMismatchesFastPathOptions, MismatchType } from '@nitpicker/query';
import type { Hono } from 'hono';

import { getMismatchesFastPath, isViewerReadModelCurrent } from '@nitpicker/query';

import { toMismatchesSortBy } from '../query-params/to-mismatches-sort-by.js';
import { toNumber } from '../query-params/to-number.js';
import { toPageSortOrder } from '../query-params/to-page-sort-order.js';
import { refuseIfStaleReadModel } from '../refuse-if-stale-read-model.js';

/** Valid `type` values for the mismatches route. */
const VALID_MISMATCH_TYPES = ['canonical', 'og:title', 'og:description'] as const;

/**
 * Registers `GET /api/mismatches?type=canonical|og:title|og:description&limit=&offset=&urlPattern=&sortBy=&sortOrder=&cursor=&direction=`
 * — paginated, filterable metadata mismatches (issue #115). `type` may be
 * repeated (`?type=canonical&type=og:title`) for an OR across several
 * comparisons, or omitted entirely for every type.
 *
 * Dispatches through `getMismatchesFastPath`, the same helper the CLI
 * `query mismatches` sub-command and MCP `find_mismatches` tool use:
 * `viewer_mismatches` (the read-model fast path) when current and neither
 * `sortBy` nor `urlPattern` is set, else the live `findMismatches`
 * write-model path. Always returns a `CursorPaginatedMismatchList` (with
 * `nextCursor`/`prevCursor` both `null` on the live branch), matching
 * `registerHeaderChecksRoute`'s response-shape contract.
 *
 * `cursor`/`direction` are read from the query string and forwarded
 * verbatim — this is the only production entry point that ever sets them
 * (CLI/MCP callers only ever pass `offset`), the same convention
 * `registerHeaderChecksRoute` documents for its own route.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerMismatchesRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/mismatches', async (c) => {
		const rawTypes = c.req.queries('type');
		if (rawTypes?.some((t) => !(VALID_MISMATCH_TYPES as readonly string[]).includes(t))) {
			return c.json(
				{
					error: `Invalid type. Must be one of: ${VALID_MISMATCH_TYPES.join(', ')}`,
				},
				400,
			);
		}
		const type = rawTypes as MismatchType[] | undefined;
		const accessor = context.manager.get(context.archiveId);
		const options: FindMismatchesFastPathOptions = {
			limit: toNumber(c.req.query('limit')),
			offset: toNumber(c.req.query('offset')),
			urlPattern: c.req.query('urlPattern'),
			// Allowlist-narrowed, never an unvalidated cast: an unknown value
			// would fall through getMismatchesSortSpec's exhaustive switch and
			// crash the request with an opaque 500 (see toMismatchesSortBy).
			sortBy: toMismatchesSortBy(c.req.query('sortBy')),
			sortOrder: toPageSortOrder(c.req.query('sortOrder')),
			cursor: c.req.query('cursor') || undefined,
			direction: c.req.query('direction') === 'prev' ? 'prev' : undefined,
			// Issue #294: a cold connection's live-fallback `sortBy: 'url'`
			// lazily builds the URL natural-sort TEMP table, which can take
			// a while on a large archive with no other signal it isn't
			// hung.
			// eslint-disable-next-line no-console
			onSortProgress: (message) => console.error(message),
		};

		// No filter forces a live fallback for /api/mismatches (see
		// getMismatchesFastPath's docs) — the only reason that function
		// degrades to live is a stale/missing read model, which this gate
		// turns into an actionable response instead. Decided here, one level
		// above the shared CLI/MCP/viewer fast-path helper, so those
		// non-interactive callers keep silently degrading.
		const isReadModelCurrent = await isViewerReadModelCurrent(accessor);
		const refused = refuseIfStaleReadModel(c, context.mode, isReadModelCurrent);
		if (refused) {
			return refused;
		}

		const result = await getMismatchesFastPath(
			accessor,
			type,
			options,
			isReadModelCurrent,
		);
		return c.json(result);
	});
}
