import type { ViewerOptions } from './types.js';

import path from 'node:path';

import { Lanes } from '@d-zero/dealer';
import { serve } from '@hono/node-server';

import { createArchiveContext } from './archive-context.js';
import { createApp } from './create-app.js';
import { findFreePort } from './find-free-port.js';
import { openBrowser } from './open-browser.js';
import { prepareCachedUrlSortTempTable } from './url-sort-cache.js';

/** Default port the viewer prefers before falling back to an ephemeral one. */
const DEFAULT_PORT = 4324;

/** Lane id for the startup URL-sort progress display. */
const URL_SORT_LANE = 0;

/**
 * Launches the Viewer: opens the archive, starts the Hono server, optionally
 * opens the browser, and stays resident until SIGINT/SIGTERM.
 *
 * **Resident by design.** Unlike the other (batch) CLI commands, this never
 * resolves until a shutdown signal arrives — so the CLI's trailing
 * `process.exit` is not reached while the server is running. On signal it
 * closes the archive (`closeAll`) and the server, then resolves for a clean exit.
 *
 * The SIGINT/SIGTERM listener is installed before the startup URL sort runs,
 * not after: that sort can take multiple minutes on a million-plus-URL
 * archive (see `externalSortUrls`' JSDoc) and writes scratch/cache files to
 * disk, so a Ctrl-C during that window must still close the archive —
 * otherwise Node's default SIGINT disposition (immediate exit) skips
 * `externalSortUrls`'/`url-sort-cache.ts`'s `finally`-block cleanup and
 * leaks chunk-file scratch directories and a stray cache tmp file under the
 * archive's (never-actively-evicted) tar-cache directory.
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

	// Assigned exactly once, well after this declaration (once the sort below
	// completes) — `let` is required because `shutdown` below must close over
	// it before it exists, so it can still close the server if a signal
	// arrives after `serve()` runs.
	// eslint-disable-next-line prefer-const
	let server: ReturnType<typeof serve> | undefined;
	let shuttingDown = false;
	const shutdownPromise = new Promise<void>((resolve) => {
		const shutdown = () => {
			shuttingDown = true;
			void (async () => {
				try {
					await context.manager.closeAll();
				} catch {
					// Ignore close errors during shutdown — we are exiting anyway.
				} finally {
					server?.close();
					resolve();
				}
			})();
		};
		process.once('SIGINT', shutdown);
		process.once('SIGTERM', shutdown);
	});

	// A million-plus-URL archive's startup sort can take multiple minutes with
	// no other observable output (see externalSortUrls' JSDoc) — Lanes gives
	// the operator the same progress display style used by `analyze`/`report`
	// instead of a silent-looking hang. Cached on disk (see
	// prepareCachedUrlSortTempTable) so a Ctrl-C / re-open replays the prior
	// sort instead of re-running it.
	const sortLanes = new Lanes({ verbose: !process.stdout.isTTY, indent: '  ' });
	try {
		await prepareCachedUrlSortTempTable(context, (message) =>
			sortLanes.update(URL_SORT_LANE, message),
		);
	} catch (error) {
		// A SIGINT/SIGTERM mid-sort closes the archive out from under the
		// in-flight query, which surfaces here as a DB error — that is the
		// shutdown path above already in progress, not a real failure.
		if (shuttingDown) {
			await shutdownPromise;
			return;
		}
		throw error;
	} finally {
		sortLanes.close();
	}
	if (shuttingDown) {
		await shutdownPromise;
		return;
	}

	const publicDir = path.resolve(import.meta.dirname, 'public');
	const app = createApp({ context, publicDir });

	server = serve({ fetch: app.fetch, port, hostname: host });
	const url = `http://${host}:${port}`;
	// eslint-disable-next-line no-console
	console.log(`\n  Nitpicker Viewer\n  ➜  ${url}\n  (Ctrl-C to stop)\n`);
	if (open) {
		openBrowser(url);
	}

	await shutdownPromise;
}
