import type { ArchiveContext, InboundLinksUnavailable } from '../types.js';
import type { InboundLinkList } from '@nitpicker/query';
import type { Hono } from 'hono';

import { listInboundLinks } from '@nitpicker/query';

import { toNumber } from '../query-params/to-number.js';

/**
 * Registers `GET /api/pages/inbound-links?url=&limit=&offset=&cursor=&direction=` —
 * a bounded, cursor-paginated window of pages linking to a target page, plus
 * its total referrer count.
 *
 * There is no legacy fallback (unlike `/api/links` and most other
 * `viewer_*`-backed routes): `listInboundLinks` reads exclusively from
 * `viewer_anchor_facts`, so in stub mode — where that read model cannot
 * exist — this responds with {@link InboundLinksUnavailable} instead of
 * attempting a query that would only throw.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerInboundLinksRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/pages/inbound-links', async (c) => {
		const url = c.req.query('url');
		if (!url) {
			return c.json({ error: 'Missing required query parameter: url' }, 400);
		}
		if (context.mode === 'stub') {
			const unavailable: InboundLinksUnavailable = { available: false };
			return c.json(unavailable);
		}
		const accessor = context.manager.get(context.archiveId);
		const result: InboundLinkList | null = await listInboundLinks(accessor, {
			url,
			limit: toNumber(c.req.query('limit')),
			offset: toNumber(c.req.query('offset')),
			cursor: c.req.query('cursor'),
			direction: c.req.query('direction') === 'prev' ? 'prev' : undefined,
		});
		if (!result) {
			return c.json({ error: 'Page not found' }, 404);
		}
		return c.json(result);
	});
}
