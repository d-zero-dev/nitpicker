import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { listDedupeCapEvents } from '@nitpicker/query';

/**
 * Effectively-unbounded page size — the Crawl Suppression view needs every
 * recorded cap event, not a page of them. Mirrors
 * `register-network-outages-route.ts`'s identical rationale
 * (`ALL_OUTAGES_LIMIT`).
 */
const ALL_DEDUPE_CAP_EVENTS_LIMIT = 10_000;

/**
 * Registers `GET /api/dedupe-cap-events` — URL shapes the opt-in
 * `--dedupe-cap` crawl flag confirmed as self-generating traps (issue
 * #208), via `@nitpicker/query`'s `listDedupeCapEvents`. Backs the Crawl
 * Suppression view (`/crawl-suppression`), the viewer's dedicated nav item
 * for this data.
 *
 * No cache layer, same reasoning as `register-network-outages-route.ts`:
 * `listDedupeCapEvents` is already a small, direct `dedupe_cap_events` read
 * with no separate fast-path/live split. Live in stub mode too — a cap
 * confirmed moments ago by an in-progress crawl should show up immediately.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerDedupeCapEventsRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/dedupe-cap-events', async (c) => {
		const accessor = context.manager.get(context.archiveId);
		const result = await listDedupeCapEvents(accessor, {
			limit: ALL_DEDUPE_CAP_EVENTS_LIMIT,
		});
		return c.json(result);
	});
}
