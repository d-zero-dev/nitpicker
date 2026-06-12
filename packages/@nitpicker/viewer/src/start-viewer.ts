import type { ViewerOptions } from './types.js';

import path from 'node:path';

import { serve } from '@hono/node-server';

import { createArchiveContext } from './archive-context.js';
import { createApp } from './create-app.js';
import { findFreePort } from './find-free-port.js';
import { openBrowser } from './open-browser.js';

/** Default port the viewer prefers before falling back to an ephemeral one. */
const DEFAULT_PORT = 4324;

/**
 * Launches the Viewer: opens the archive, starts the Hono server, optionally
 * opens the browser, and stays resident until SIGINT/SIGTERM.
 *
 * **Resident by design.** Unlike the other (batch) CLI commands, this never
 * resolves until a shutdown signal arrives — so the CLI's trailing
 * `process.exit` is not reached while the server is running. On signal it
 * closes the archive (`closeAll`) and the server, then resolves for a clean exit.
 * @param options - Launch options (file path, port, host, open).
 * @returns Resolves only after the server has shut down gracefully.
 */
export async function startViewer(options: ViewerOptions): Promise<void> {
	const { filePath, host = 'localhost', open = true } = options;
	// Probe the same host the server will bind to, so an occupied port on that
	// interface (e.g. `::1` for `localhost`) triggers the ephemeral fallback
	// instead of a post-banner `EADDRINUSE` crash.
	const port = await findFreePort(options.port ?? DEFAULT_PORT, host);
	const context = await createArchiveContext(filePath);
	const publicDir = path.resolve(import.meta.dirname, 'public');
	const app = createApp({ context, publicDir });

	const server = serve({ fetch: app.fetch, port, hostname: host });
	const url = `http://${host}:${port}`;
	// eslint-disable-next-line no-console
	console.log(`\n  Nitpicker Viewer\n  ➜  ${url}\n  (Ctrl-C to stop)\n`);
	if (open) {
		openBrowser(url);
	}

	await new Promise<void>((resolve) => {
		const shutdown = () => {
			void (async () => {
				try {
					await context.manager.closeAll();
				} catch {
					// Ignore close errors during shutdown — we are exiting anyway.
				} finally {
					server.close();
					resolve();
				}
			})();
		};
		process.once('SIGINT', shutdown);
		process.once('SIGTERM', shutdown);
	});
}
