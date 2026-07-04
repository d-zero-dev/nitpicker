import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { getCachedErrorKinds } from '../error-kinds-cache.js';

/**
 * Registers `GET /api/error-kinds` — crawl failures classified by cause
 * (DNS, connection, TLS, timeout, protocol, …) with per-host breakdown and
 * sample URLs.
 *
 * The viewer caches the computed `ErrorKindsResult` per `archiveId` so
 * second and later hits return from in-process memory without re-entering
 * SQLite. See {@link getCachedErrorKinds} for the archive-vs-stub mode
 * semantics and `getErrorKindsFastPath` for how the cause is derived.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerErrorKindsRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/error-kinds', async (c) => {
		return c.json(await getCachedErrorKinds(context));
	});
}
