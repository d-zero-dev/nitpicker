import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { listLinks } from '@nitpicker/query';

import { toNumber } from '../query-params/to-number.js';

/** Valid `type` values for the links route. */
const VALID_LINK_TYPES = ['broken', 'external', 'orphaned'] as const;

/**
 * Registers `GET /api/links?type=broken|external|orphaned` — link analysis.
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
		const result = await listLinks(accessor, {
			type: type as (typeof VALID_LINK_TYPES)[number],
			limit: toNumber(c.req.query('limit')),
			offset: toNumber(c.req.query('offset')),
		});
		return c.json(result);
	});
}
