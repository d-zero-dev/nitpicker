import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { getResourceReferrers } from '@nitpicker/query';

/**
 * Registers `GET /api/resources/referrers?resourceUrl=` — pages referencing a resource.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerResourceReferrersRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/resources/referrers', async (c) => {
		const resourceUrl = c.req.query('resourceUrl');
		if (!resourceUrl) {
			return c.json({ error: 'Missing required query parameter: resourceUrl' }, 400);
		}
		const accessor = context.manager.get(context.archiveId);
		const result = await getResourceReferrers(accessor, resourceUrl);
		if (!result) {
			return c.json({ error: 'Resource not found' }, 404);
		}
		return c.json(result);
	});
}
