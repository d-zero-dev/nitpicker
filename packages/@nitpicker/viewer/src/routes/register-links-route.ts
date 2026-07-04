import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { listExternalLinks, listLinks } from '@nitpicker/query';

import { toNumber } from '../query-params/to-number.js';

/** Valid `type` values for the links route. */
const VALID_LINK_TYPES = ['broken', 'external'] as const;

/**
 * Registers `GET /api/links?type=broken|external` — link analysis.
 *
 * `orphaned` was retired: completely isolated inventory-* pages are reported
 * by `/api/isolated-pages`, and interconnected orphan clusters by
 * `/api/isolated-clusters`. `broken` stays anchor-level (one row per `<a>`
 * tag, resolved through `pages.redirectDestId` to the canonical final
 * destination unless `includeRedirectSources=true`) via `listLinks`.
 * `external` is deduplicated by canonical destination via
 * `listExternalLinks` — one row per unique destination with a
 * `referrerCount` — so its response shape and query params differ (no
 * `includeRedirectSources`, no `sourceUrl`/`isExternal`/`textContent`
 * sort keys, an added `referrerCount` sort key).
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerLinksRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/links', async (c) => {
		const type = c.req.query('type');
		if (!type || !(VALID_LINK_TYPES as readonly string[]).includes(type)) {
			return c.json(
				{
					error: `Invalid or missing type. Must be one of: ${VALID_LINK_TYPES.join(', ')}`,
				},
				400,
			);
		}
		const accessor = context.manager.get(context.archiveId);
		const limit = toNumber(c.req.query('limit'));
		const offset = toNumber(c.req.query('offset'));
		const urlPattern = c.req.query('urlPattern');
		const status = toNumber(c.req.query('status'));
		const sortOrder = c.req.query('sortOrder') as 'asc' | 'desc' | undefined;

		if (type === 'external') {
			const result = await listExternalLinks(accessor, {
				limit,
				offset,
				urlPattern,
				status,
				sortBy: c.req.query('sortBy') as
					| 'destUrl'
					| 'status'
					| 'referrerCount'
					| undefined,
				sortOrder,
			});
			return c.json(result);
		}

		const includeRedirectSources = c.req.query('includeRedirectSources') === 'true';
		const result = await listLinks(accessor, {
			type: 'broken',
			limit,
			offset,
			includeRedirectSources,
			urlPattern,
			status,
			sortBy: c.req.query('sortBy') as
				| 'sourceUrl'
				| 'destUrl'
				| 'status'
				| 'isExternal'
				| 'textContent'
				| undefined,
			sortOrder,
		});
		return c.json(result);
	});
}
