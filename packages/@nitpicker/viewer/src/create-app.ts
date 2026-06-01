import type { CreateAppOptions } from './types.js';

import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

import { registerArchiveInfoRoute } from './routes/register-archive-info-route.js';
import { registerDuplicatesRoute } from './routes/register-duplicates-route.js';
import { registerGraphRoute } from './routes/register-graph-route.js';
import { registerHeadersRoute } from './routes/register-headers-route.js';
import { registerImagesRoute } from './routes/register-images-route.js';
import { registerLinksRoute } from './routes/register-links-route.js';
import { registerMismatchesRoute } from './routes/register-mismatches-route.js';
import { registerPageDetailRoute } from './routes/register-page-detail-route.js';
import { registerPageHtmlRoute } from './routes/register-page-html-route.js';
import { registerPageLinksRoute } from './routes/register-page-links-route.js';
import { registerPagesRoute } from './routes/register-pages-route.js';
import { registerResourceReferrersRoute } from './routes/register-resource-referrers-route.js';
import { registerResourcesRoute } from './routes/register-resources-route.js';
import { registerSummaryRoute } from './routes/register-summary-route.js';
import { registerViolationsRoute } from './routes/register-violations-route.js';
import { sanitizeErrorMessage } from './sanitize-error-message.js';

/**
 * Builds the Hono application: registers all REST API routes, a sanitizing
 * error handler, and static serving of the built frontend (with SPA root).
 *
 * The archive is fixed at launch, so routes carry no `archiveId` — the
 * context resolves the single opened archive internally.
 * @param options - The archive context and the built-asset directory.
 * @returns The configured Hono application.
 */
export function createApp(options: CreateAppOptions): Hono {
	const { context, publicDir } = options;
	const app = new Hono();

	registerSummaryRoute(app, context);
	registerPagesRoute(app, context);
	registerPageDetailRoute(app, context);
	registerPageHtmlRoute(app, context);
	registerLinksRoute(app, context);
	registerResourcesRoute(app, context);
	registerResourceReferrersRoute(app, context);
	registerImagesRoute(app, context);
	registerViolationsRoute(app, context);
	registerDuplicatesRoute(app, context);
	registerMismatchesRoute(app, context);
	registerHeadersRoute(app, context);
	registerGraphRoute(app, context);
	registerPageLinksRoute(app, context);
	registerArchiveInfoRoute(app, context);

	app.onError((error, c) => {
		const raw = error instanceof Error ? error.message : String(error);
		return c.json({ error: sanitizeErrorMessage(raw) }, 500);
	});

	// Static frontend assets first; then an SPA fallback so any unmatched GET
	// (a client-side route like /pages, or a reload of one) returns index.html.
	// This lets the frontend use BrowserRouter (History API) with clean URLs.
	app.use('/*', serveStatic({ root: publicDir }));
	app.get('*', serveStatic({ root: publicDir, path: 'index.html' }));

	return app;
}
