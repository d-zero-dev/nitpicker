import type { ArchiveContext } from '../types.js';
import type { GetDuplicatesFastPathOptions } from '@nitpicker/query';
import type { Hono } from 'hono';

import {
	getDuplicatesFastPath,
	isViewerReadModelCurrent,
	listViewerDuplicateGroupPages,
} from '@nitpicker/query';

import { toNumber } from '../query-params/to-number.js';

/** Valid `field` values for the duplicates route. */
const VALID_DUPLICATE_FIELDS = ['title', 'description'] as const;

/**
 * Registers the duplicate-metadata viewer endpoints (issue #115):
 *
 * - `GET /api/duplicates?field=title|description&limit=&pagesLimit=&cursor=&direction=&offset=`
 *   — paginated duplicate-value groups, dispatched through
 *   `getDuplicatesFastPath` (the same helper the CLI `query duplicates`
 *   sub-command and MCP `find_duplicates` tool use): `viewer_duplicate_groups`
 *   (the read-model fast path) when current, else the legacy `findDuplicates`
 *   write-model path. Always returns a `CursorPaginatedDuplicateGroupList`
 *   (with `nextCursor`/`prevCursor` both `null` on the legacy branch).
 * - `GET /api/duplicates/:groupId/pages?limit=&cursor=&direction=&offset=`
 *   — the COMPLETE member-page list for one group, once the inline
 *   `pages` sample on the list endpoint runs out (`count > pages.length`).
 *   This endpoint has no legacy counterpart — `groupId` is a
 *   `viewer_duplicate_groups`-only concept, so it 404s outright when the
 *   read model is not current instead of guessing a legacy equivalent.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerDuplicatesRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/duplicates', async (c) => {
		const field = c.req.query('field');
		if (
			field !== undefined &&
			!(VALID_DUPLICATE_FIELDS as readonly string[]).includes(field)
		) {
			return c.json(
				{ error: `Invalid field. Must be one of: ${VALID_DUPLICATE_FIELDS.join(', ')}` },
				400,
			);
		}
		const accessor = context.manager.get(context.archiveId);
		const options: GetDuplicatesFastPathOptions = {
			field: field as GetDuplicatesFastPathOptions['field'],
			limit: toNumber(c.req.query('limit')),
			pagesLimit: toNumber(c.req.query('pagesLimit')),
			cursor: c.req.query('cursor') || undefined,
			direction: c.req.query('direction') === 'prev' ? 'prev' : undefined,
			offset: toNumber(c.req.query('offset')),
		};
		return c.json(await getDuplicatesFastPath(accessor, options));
	});

	app.get('/api/duplicates/:groupId/pages', async (c) => {
		const groupId = Number(c.req.param('groupId'));
		if (Number.isNaN(groupId)) {
			return c.json({ error: 'Invalid groupId — must be a number' }, 400);
		}
		// A non-positive `groupId` can only ever be the negative sentinel
		// `getDuplicatesFastPath`'s legacy-fallback branch mints (`-(index +
		// 1)`), never a real `viewer_duplicate_groups.group_id` (an
		// `INTEGER PRIMARY KEY` starting at 1). Reject it outright instead of
		// forwarding to `listViewerDuplicateGroupPages`, which would otherwise
		// happily return whatever real group the read model — possibly built
		// AFTER the client's `/api/duplicates` call minted this sentinel —
		// happens to have at that unrelated numeric id. See
		// `getDuplicatesFastPath`'s docs for why the legacy branch never
		// truncates `pages` in the first place, so there is nothing to drill
		// into here anyway.
		if (groupId <= 0) {
			return c.json(
				{
					error:
						'Invalid groupId — this group came from the non-paginated legacy fallback and has no separate page list to fetch (its `pages` array is already complete).',
				},
				404,
			);
		}
		const accessor = context.manager.get(context.archiveId);
		if (!(await isViewerReadModelCurrent(accessor))) {
			return c.json(
				{
					error:
						'Duplicate-group member pages require the viewer read model, which is not built or is stale for this archive. Rebuild it with `nitpicker viewer-build`.',
				},
				404,
			);
		}
		const result = await listViewerDuplicateGroupPages(accessor, {
			groupId,
			limit: toNumber(c.req.query('limit')),
			cursor: c.req.query('cursor') || undefined,
			direction: c.req.query('direction') === 'prev' ? 'prev' : undefined,
			offset: toNumber(c.req.query('offset')),
		});
		return c.json(result);
	});
}
