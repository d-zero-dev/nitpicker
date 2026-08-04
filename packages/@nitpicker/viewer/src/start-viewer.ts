import type { ViewerOptions } from './types.js';

import path from 'node:path';

import { serve } from '@hono/node-server';
import { isViewerReadModelCurrent } from '@nitpicker/query';

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
 *
 * **No eager startup URL sort.** This used to unconditionally run the
 * natural-sort external merge sort (`prepareCachedUrlSortTempTable`) before
 * ever starting the server — a multi-minute cost on a million-plus-URL
 * archive, paid on every open regardless of whether the read model was
 * current. `viewer_pages.natural_url_rank` (built once at crawl/migration
 * completion, see `buildViewerReadModel`) now covers the fast path's default
 * URL order, so a current read model never needs the sort at all. The
 * live (stale/missing read model) query path still needs it, but prepares
 * it lazily on its own first request via `ensureUrlSortTempTable` — see
 * `list-pages.ts` — rather than the viewer paying for it upfront on every
 * single start regardless of whether that path is even reached.
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

	// Stub mode can never have a current read model (it's built at
	// crawl-end/`viewer-build`, neither of which has run yet for an
	// in-progress crawl) — warning there would be permanent, unactionable
	// noise, so this only fires for a finished `.nitpicker` archive. Routes
	// (`shouldRefuseStaleReadModel`) refuse individual stale-read-model
	// requests regardless of whether this banner was seen; this is purely a
	// heads-up printed once at startup so the fix (`viewer-build`) is visible
	// before the user has to hit a "read model required" response first.
	if (context.mode !== 'stub') {
		const accessor = context.manager.get(context.archiveId);
		if (!(await isViewerReadModelCurrent(accessor))) {
			// eslint-disable-next-line no-console
			console.warn(
				"\n  ⚠ This archive's viewer read model is missing or stale.\n" +
					'    Pages/resources/links/images and similar list views will\n' +
					'    respond with "read model required" until you rebuild it:\n\n' +
					`      nitpicker viewer-build ${filePath}\n`,
			);
		}
	}

	// Assigned exactly once, right after this declaration — `let` is required
	// because `shutdown` below must close over it before it exists, so it can
	// still close the server if a signal arrives after `serve()` runs.
	// eslint-disable-next-line prefer-const
	let server: ReturnType<typeof serve> | undefined;
	const shutdownPromise = new Promise<void>((resolve) => {
		const shutdown = () => {
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
