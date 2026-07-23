import type { PortRef } from '../server.js';
import type { Hono } from 'hono';

/**
 * Registers routes for testing crawler options such as query strings, external links, and JSON resources.
 * @param app - The Hono application instance to register routes on.
 * @param portRef - Holder for the server's actual listening port, used to
 *   build the self-referencing "external" (127.0.0.1) URLs below.
 */
export function optionsRoutes(app: Hono, portRef: PortRef) {
	app.get('/options/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Options Top</title></head><body>' +
				'<a href="/options/page-a?tab=1">Page A</a>' +
				`<a href="http://127.0.0.1:${portRef.port}/options/external">External</a>` +
				'<a href="/options/data.json">Internal JSON</a>' +
				`<a href="http://127.0.0.1:${portRef.port}/options/data.json">External JSON</a>` +
				'</body></html>',
		),
	);

	app.get('/options/page-a', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Options Page A</title></head><body>' +
				'<p>Options page A content.</p>' +
				'</body></html>',
		),
	);

	app.get('/options/data.json', (c) => c.json({ test: true }));

	app.get('/options/external', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Options External</title></head><body>' +
				'<p>External page content.</p>' +
				'</body></html>',
		),
	);
}
