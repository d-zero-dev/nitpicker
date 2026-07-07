import type { ArchiveContext } from '../types.js';
import type { FindMismatchesFastPathOptions } from '@nitpicker/query';
import type { Hono } from 'hono';

import { getMismatchesFastPath } from '@nitpicker/query';

import { toNumber } from '../query-params/to-number.js';
import { toPageSortOrder } from '../query-params/to-page-sort-order.js';

/** Valid `type` values for the mismatches route. */
const VALID_MISMATCH_TYPES = ['canonical', 'og:title', 'og:description'] as const;

/**
 * Registers `GET /api/mismatches?type=canonical|og:title|og:description&limit=&offset=&urlPattern=&sortBy=&sortOrder=&cursor=&direction=`
 * — paginated, filterable metadata mismatches (issue #115).
 *
 * Dispatches through `getMismatchesFastPath`, the same helper the CLI
 * `query mismatches` sub-command and MCP `find_mismatches` tool use:
 * `viewer_mismatches` (the read-model fast path) when current and neither
 * `sortBy` nor `urlPattern` is set, else the legacy `findMismatches`
 * write-model path. Always returns a `CursorPaginatedMismatchList` (with
 * `nextCursor`/`prevCursor` both `null` on the legacy branch), matching
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
		const type = c.req.query('type');
		if (!type || !(VALID_MISMATCH_TYPES as readonly string[]).includes(type)) {
			return c.json(
				{
					error: `Invalid or missing type. Must be one of: ${VALID_MISMATCH_TYPES.join(', ')}`,
				},
				400,
			);
		}
		const accessor = context.manager.get(context.archiveId);
		const options: FindMismatchesFastPathOptions = {
			limit: toNumber(c.req.query('limit')),
			offset: toNumber(c.req.query('offset')),
			urlPattern: c.req.query('urlPattern'),
			sortBy: c.req.query('sortBy') as FindMismatchesFastPathOptions['sortBy'],
			sortOrder: toPageSortOrder(c.req.query('sortOrder')),
			cursor: c.req.query('cursor') || undefined,
			direction: c.req.query('direction') === 'prev' ? 'prev' : undefined,
		};
		const result = await getMismatchesFastPath(
			accessor,
			type as (typeof VALID_MISMATCH_TYPES)[number],
			options,
		);
		return c.json(result);
	});
}
