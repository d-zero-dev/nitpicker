import type { ArchiveContext } from '../types.js';
import type { ListPageLinksOptions } from '@nitpicker/query';
import type { Hono } from 'hono';

import { listPageLinks } from '@nitpicker/query';

import { toBoolean } from '../query-params/to-boolean.js';
import { toNumber } from '../query-params/to-number.js';
import { getCachedReferrerCounts } from '../referrer-count-cache.js';

/**
 * Registers `GET /api/page-links` — per-page network info (google-sheets
 * "Links" sheet equivalent: one row per page with status, redirects,
 * referrer count, headers).
 *
 * In archive-file mode the per-archive referrer-count map is computed
 * once and cached; every subsequent paging click reuses it. In stub
 * mode (live crawl) the cache returns `null` so the route falls back
 * to the per-row correlated subquery — slower but always live. See
 * {@link getCachedReferrerCounts} for the cache contract.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerPageLinksRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/page-links', async (c) => {
		const q = c.req.query();
		const accessor = context.manager.get(context.archiveId);
		const referrerMap = await getCachedReferrerCounts(context);
		const options: ListPageLinksOptions = {
			isExternal: toBoolean(q.isExternal),
			urlPattern: q.urlPattern,
			contentType: q.contentType,
			hasResponseHeaders: toBoolean(q.hasResponseHeaders),
			sortBy: q.sortBy as ListPageLinksOptions['sortBy'],
			sortOrder: q.sortOrder as ListPageLinksOptions['sortOrder'],
			limit: toNumber(q.limit),
			offset: toNumber(q.offset),
			// `null` from stub mode → undefined option → `listPageLinks`
			// falls back to its correlated-subquery path.
			...(referrerMap === null ? {} : { precomputedReferrerCounts: referrerMap }),
		};
		return c.json(await listPageLinks(accessor, options));
	});
}
