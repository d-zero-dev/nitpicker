import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { checkHeaders } from '@nitpicker/query';

import { toBoolean } from '../query-params/to-boolean.js';
import { toNumber } from '../query-params/to-number.js';

/**
 * Registers `GET /api/headers` — security header checks (CSP/X-Frame-Options/etc.).
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerHeadersRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/headers', async (c) => {
		const accessor = context.manager.get(context.archiveId);
		const result = await checkHeaders(accessor, {
			missingOnly: toBoolean(c.req.query('missingOnly')),
			limit: toNumber(c.req.query('limit')),
			offset: toNumber(c.req.query('offset')),
		});
		return c.json(result);
	});
}
