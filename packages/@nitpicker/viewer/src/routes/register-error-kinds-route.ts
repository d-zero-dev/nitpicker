import type { ArchiveContext } from '../types.js';
import type { ErrorKind } from '@nitpicker/query';
import type { Hono } from 'hono';

import { getErrorKinds } from '@nitpicker/query';

import { toNumber } from '../query-params/to-number.js';

/**
 * Registers `GET /api/error-kinds` — crawl failures classified by cause
 * (DNS, connection, TLS, timeout, protocol, …), one row per host×kind pair
 * with sample URLs. See {@link getErrorKinds} for how the cause is derived.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerErrorKindsRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/error-kinds', async (c) => {
		const accessor = context.manager.get(context.archiveId);
		const result = await getErrorKinds(accessor, {
			host: c.req.query('host'),
			kind: c.req.query('kind') as ErrorKind | undefined,
			sortBy: c.req.query('sortBy') as 'host' | 'kind' | 'count' | undefined,
			sortOrder: c.req.query('sortOrder') as 'asc' | 'desc' | undefined,
			limit: toNumber(c.req.query('limit')),
			offset: toNumber(c.req.query('offset')),
		});
		return c.json(result);
	});
}
