import type { ArchiveContext } from '../types.js';
import type { GetImagesFastPathOptions } from '@nitpicker/query';
import type { Hono } from 'hono';

import {
	getImagesFastPath,
	isImagesFastPathSortBy,
	isViewerReadModelCurrent,
} from '@nitpicker/query';

import { toBoolean } from '../query-params/to-boolean.js';
import { toMultiValue } from '../query-params/to-multi-value.js';
import { toNumber } from '../query-params/to-number.js';
import { toPageSortOrder } from '../query-params/to-page-sort-order.js';
import { refuseIfStaleReadModel } from '../refuse-if-stale-read-model.js';

/**
 * Registers `GET /api/images` — paginated, filterable image list.
 *
 * Dispatches through `getImagesFastPath`, the same helper the CLI
 * `query images` sub-command and MCP `list_images` tool use (issue #113):
 * `viewer_images` (the read-model fast path) when current and the request
 * doesn't use `urlPattern` or a `src`/`alt` sort (the wide `images` table's
 * large text columns, never duplicated onto the read model), else the
 * live `listImages` write-model path. Unlike `registerResourcesRoute`, no
 * separate live-cursor shimming is needed here: `getImagesFastPath` always
 * returns a `CursorPaginatedImageList` (with `nextCursor`/`prevCursor` both
 * `null` on the live branch), so the frontend's existing offset-only
 * `use-images-infinite.ts` keeps working unchanged either way.
 *
 * `cursor`/`direction` are read from the query string and forwarded
 * verbatim — this is the only production entry point that ever sets them
 * (CLI/MCP callers only ever pass `offset`), so the fast path's keyset
 * cursor pagination is reachable outside its own unit tests.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerImagesRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/images', async (c) => {
		const q = c.req.query();
		const accessor = context.manager.get(context.archiveId);
		const options: GetImagesFastPathOptions = {
			missingAlt: toMultiValue(c.req.queries('missingAlt'), toBoolean),
			missingDimensions: toMultiValue(c.req.queries('missingDimensions'), toBoolean),
			oversizedThreshold: toNumber(q.oversizedThreshold),
			urlPattern: q.urlPattern,
			sortBy: q.sortBy as GetImagesFastPathOptions['sortBy'],
			sortOrder: toPageSortOrder(q.sortOrder),
			limit: toNumber(q.limit),
			offset: toNumber(q.offset),
			cursor: q.cursor || undefined,
			direction: q.direction === 'prev' ? 'prev' : undefined,
		};

		// `isImagesFastPathSortBy` is the same predicate `getImagesFastPath`
		// itself dispatches on — the refusal gate must never fire for a
		// request that was always going to take the live path anyway
		// (urlPattern / src / alt — structural, see getImagesFastPath's docs).
		const usesWideTableOnlyFilter =
			options.urlPattern != null ||
			(options.sortBy != null && !isImagesFastPathSortBy(options.sortBy));
		const isReadModelCurrent = await isViewerReadModelCurrent(accessor);
		if (!usesWideTableOnlyFilter) {
			const refused = refuseIfStaleReadModel(c, context.mode, isReadModelCurrent);
			if (refused) {
				return refused;
			}
		}

		return c.json(await getImagesFastPath(accessor, options, isReadModelCurrent));
	});
}
