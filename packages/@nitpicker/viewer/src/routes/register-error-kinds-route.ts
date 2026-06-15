import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { getErrorKinds } from '@nitpicker/query';

/**
 * Registers `GET /api/error-kinds` — crawl failures classified by cause
 * (DNS, connection, TLS, timeout, protocol, …) with per-host breakdown and
 * sample URLs. See {@link getErrorKinds} for how the cause is derived.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerErrorKindsRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/error-kinds', async (c) => {
		const accessor = context.manager.get(context.archiveId);
		return c.json(await getErrorKinds(accessor));
	});
}
