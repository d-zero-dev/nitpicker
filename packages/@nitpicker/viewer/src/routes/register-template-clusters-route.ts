import type { ArchiveContext } from '../types.js';
import type { Hono } from 'hono';

import { getCachedTemplateClusters } from '../template-clusters-cache.js';

/**
 * Registers `GET /api/template-clusters` — a summary of every
 * `page_templates.template_key` cluster in the archive (page count and
 * common directory computed fresh from each cluster's member pages, plus
 * the `ClusterReason` `@d-zero/page-cluster` reported when it classified
 * the cluster) since the raw key itself isn't human-readable (see
 * `@nitpicker/query`'s `TemplateClusterSummary` JSDoc).
 *
 * Takes no query parameters and returns every cluster in one response —
 * `page_templates` is a dedicated table with no viewer read-model fast
 * path, and its cluster count tops out in the low hundreds even on a
 * 486,000-page archive, so pagination would add complexity without a real
 * payload-size problem to solve.
 * @param app - The Hono application.
 * @param context - The opened archive context.
 */
export function registerTemplateClustersRoute(app: Hono, context: ArchiveContext): void {
	app.get('/api/template-clusters', async (c) => {
		const result = await getCachedTemplateClusters(context);
		return c.json(result);
	});
}
