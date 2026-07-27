import type { ArchiveContext } from '../types.js';
import type { ErrorKind, FailureAttribution } from '@nitpicker/query';
import type { Hono } from 'hono';

import { getCachedErrorKinds } from '../error-kinds-cache.js';
import { toNumber } from '../query-params/to-number.js';

/**
 * Registers `GET /api/error-kinds` — crawl failures classified by cause
 * (DNS, connection, TLS, timeout, protocol, …), one row per
 * host×kind×attribution pair with sample URLs.
 *
 * The viewer caches the expensive (options-independent) classify-and-
 * aggregate pass per `archiveId` and applies `host`/`kind`/`attribution`/
 * `sortBy`/`sortOrder`/`limit`/`offset` on top of that cached snapshot, so
 * second and later hits (with any combination of query params) return from
 * in-process memory without re-entering SQLite. See {@link getCachedErrorKinds}
 * for the archive-vs-stub mode semantics and `getErrorKindsFastPath` for how
 * the cause is derived.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerErrorKindsRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/error-kinds', async (c) => {
		const result = await getCachedErrorKinds(context, {
			host: c.req.query('host'),
			kind: c.req.query('kind') as ErrorKind | undefined,
			attribution: c.req.query('attribution') as FailureAttribution | undefined,
			sortBy: c.req.query('sortBy') as 'host' | 'kind' | 'count' | undefined,
			sortOrder: c.req.query('sortOrder') as 'asc' | 'desc' | undefined,
			limit: toNumber(c.req.query('limit')),
			offset: toNumber(c.req.query('offset')),
		});
		return c.json(result);
	});
}
