import type { CreateAppOptions } from './types.js';

import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

import { registerArchiveInfoRoute } from './routes/register-archive-info-route.js';
import { registerDirectoryTreeChildrenRoute } from './routes/register-directory-tree-children-route.js';
import { registerDirectoryTreePagesRoute } from './routes/register-directory-tree-pages-route.js';
import { registerDirectoryTreeRoute } from './routes/register-directory-tree-route.js';
import { registerDuplicatesRoute } from './routes/register-duplicates-route.js';
import { registerErrorKindsRoute } from './routes/register-error-kinds-route.js';
import { registerGraphRoute } from './routes/register-graph-route.js';
import { registerImagesRoute } from './routes/register-images-route.js';
import { registerIsolatedClustersRoute } from './routes/register-isolated-clusters-route.js';
import { registerIsolatedPagesRoute } from './routes/register-isolated-pages-route.js';
import { registerLinksRoute } from './routes/register-links-route.js';
import { registerMismatchesRoute } from './routes/register-mismatches-route.js';
import { registerPageDetailRoute } from './routes/register-page-detail-route.js';
import { registerPageHtmlRoute } from './routes/register-page-html-route.js';
import { registerPagesRoute } from './routes/register-pages-route.js';
import { registerResourceReferrersRoute } from './routes/register-resource-referrers-route.js';
import { registerResourcesRoute } from './routes/register-resources-route.js';
import { registerSummaryRoute } from './routes/register-summary-route.js';
import { registerUnusedResourcesRoute } from './routes/register-unused-resources-route.js';
import { registerViolationsRoute } from './routes/register-violations-route.js';
import { sanitizeErrorMessage } from './sanitize-error-message.js';
import { serverTimingMiddleware } from './server-timing-middleware.js';

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

	// Attach Server-Timing to every API route so DevTools surfaces backend
	// wall-clock per request — primary triage tool for "is X slow because of
	// the DB or because of React?" without needing a separate profiler.
	app.use('/api/*', serverTimingMiddleware());

	registerSummaryRoute(app, context);
	registerPagesRoute(app, context);
	registerPageDetailRoute(app, context);
	registerPageHtmlRoute(app, context);
	registerDirectoryTreeRoute(app, context);
	registerDirectoryTreeChildrenRoute(app, context);
	registerDirectoryTreePagesRoute(app, context);
	registerLinksRoute(app, context);
	registerResourcesRoute(app, context);
	registerResourceReferrersRoute(app, context);
	registerImagesRoute(app, context);
	registerViolationsRoute(app, context);
	registerDuplicatesRoute(app, context);
	registerMismatchesRoute(app, context);
	registerGraphRoute(app, context);
	registerArchiveInfoRoute(app, context);
	registerErrorKindsRoute(app, context);
	registerIsolatedPagesRoute(app, context);
	registerIsolatedClustersRoute(app, context);
	registerUnusedResourcesRoute(app, context);

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
