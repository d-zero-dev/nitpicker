import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { listLinks } from '@nitpicker/query';

import { toNumber } from '../query-params/to-number.js';

/** Valid `type` values for the links route. */
const VALID_LINK_TYPES = ['broken', 'external'] as const;

/**
 * Registers `GET /api/links?type=broken|external` — link analysis.
 *
 * `orphaned` was retired: completely isolated inventory-* pages are reported
 * by `/api/isolated-pages`, and interconnected orphan clusters by
 * `/api/isolated-clusters`. Anchor destinations on `broken` / `external`
 * are resolved through `pages.redirectDestId` to the canonical final
 * destination unless `includeRedirectSources=true`.
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
		const includeRedirectSources = c.req.query('includeRedirectSources') === 'true';
		const result = await listLinks(accessor, {
			type: type as (typeof VALID_LINK_TYPES)[number],
			limit: toNumber(c.req.query('limit')),
			offset: toNumber(c.req.query('offset')),
			includeRedirectSources,
			urlPattern: c.req.query('urlPattern'),
			status: toNumber(c.req.query('status')),
			sortBy: c.req.query('sortBy') as
				| 'sourceUrl'
				| 'destUrl'
				| 'status'
				| 'isExternal'
				| 'textContent'
				| undefined,
			sortOrder: c.req.query('sortOrder') as 'asc' | 'desc' | undefined,
		});
		return c.json(result);
	});
}
