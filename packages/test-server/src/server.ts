import type { Server } from 'node:http';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import { basicRoutes } from './routes/basic.js';
import { errorStatusRoutes } from './routes/error-status.js';
import { excludeRoutes } from './routes/exclude.js';
import { metaRoutes } from './routes/meta.js';
import { optionsRoutes } from './routes/options.js';
import { paginationRoutes } from './routes/pagination.js';
import { recursiveRoutes } from './routes/recursive.js';
import { redirectRoutes } from './routes/redirect.js';
import { scopeRoutes } from './routes/scope.js';

/**
 * Creates and configures the Hono application with all E2E test routes.
 * @returns The configured Hono application instance.
 */
export function createApp() {
	const app = new Hono();

	basicRoutes(app);
	recursiveRoutes(app);
	redirectRoutes(app);
	metaRoutes(app);
	excludeRoutes(app);
	optionsRoutes(app);
	errorStatusRoutes(app);
	scopeRoutes(app);
	paginationRoutes(app);
	return app;
}

/**
 * Starts the E2E test server on the specified port.
 * @param port - The port number to listen on.
 * @returns A promise that resolves with the HTTP server instance once it is listening.
 */
export function startServer(port = 8010): Promise<Server> {
	const app = createApp();
	return new Promise((resolve) => {
		const server = serve({ fetch: app.fetch, port }, () => resolve(server));
	});
}
