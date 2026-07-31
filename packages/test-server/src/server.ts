import type { Server } from 'node:http';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import { basicRoutes } from './routes/basic.js';
import { consoleLogsRoutes } from './routes/console-logs.js';
import { dedupeCapTrapRoutes } from './routes/dedupe-cap-trap.js';
import { errorStatusRoutes } from './routes/error-status.js';
import { excludeRoutes } from './routes/exclude.js';
import { flakyRoutes } from './routes/flaky.js';
import { inventoryRoutes } from './routes/inventory.js';
import { jsRedirectRoutes } from './routes/js-redirect.js';
import { mainContentRoutes } from './routes/main-content.js';
import { metaRoutes } from './routes/meta.js';
import { optionsRoutes } from './routes/options.js';
import { paginationRoutes } from './routes/pagination.js';
import { recursiveRoutes } from './routes/recursive.js';
import { redirectRoutes } from './routes/redirect.js';
import { resourceReuseRoutes } from './routes/resource-reuse.js';
import { scopeAuthLeakRoutes } from './routes/scope-auth-leak.js';
import { scopeRoutes } from './routes/scope.js';
import { scrollJackRoutes } from './routes/scroll-jack.js';

/**
 * Mutable holder for the server's actual listening port.
 *
 * Routes that embed self-referencing "external" URLs are registered via
 * `createApp` before `serve()` resolves the OS-assigned port, so they read
 * `.port` lazily at request time instead of closing over a stale value
 * captured at registration time. `startServer` only resolves its promise
 * after setting the real port, so no request can arrive while it is still 0.
 */
export interface PortRef {
	port: number;
}

/**
 * Creates and configures the Hono application with all E2E test routes.
 * @param portRef - Holder for the server's actual listening port; passed to
 *   routes that embed self-referencing "external" URLs.
 * @returns The configured Hono application instance.
 */
export function createApp(portRef: PortRef) {
	const app = new Hono();

	basicRoutes(app);
	recursiveRoutes(app, portRef);
	redirectRoutes(app, portRef);
	metaRoutes(app, portRef);
	excludeRoutes(app, portRef);
	optionsRoutes(app, portRef);
	errorStatusRoutes(app);
	scopeRoutes(app);
	scopeAuthLeakRoutes(app, portRef);
	paginationRoutes(app);
	scrollJackRoutes(app);
	resourceReuseRoutes(app, portRef);
	flakyRoutes(app);
	inventoryRoutes(app);
	jsRedirectRoutes(app);
	mainContentRoutes(app);
	consoleLogsRoutes(app);
	dedupeCapTrapRoutes(app, portRef);
	return app;
}

/**
 * Starts the E2E test server.
 * @param port - The port number to listen on. Defaults to `0`, letting the
 *   OS assign a free port — a fixed port made concurrent worktrees/sessions
 *   running this server collide with `EADDRINUSE` (#162).
 * @returns A promise that resolves with the HTTP server instance once it is
 *   listening; the resolved server's `.address()` reports the actual port.
 */
export function startServer(port = 0): Promise<Server> {
	const portRef: PortRef = { port };
	const app = createApp(portRef);
	return new Promise((resolve) => {
		const server = serve({ fetch: app.fetch, port }, (info) => {
			portRef.port = info.port;
			resolve(server);
		});
	});
}
