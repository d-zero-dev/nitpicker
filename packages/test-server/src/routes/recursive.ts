import type { PortRef } from '../server.js';
import type { Hono } from 'hono';

/**
 * Registers routes for testing recursive link traversal and external-like host detection.
 * @param app - The Hono application instance to register routes on.
 * @param portRef - Holder for the server's actual listening port, used to
 *   build the self-referencing "external" (127.0.0.1) URL below.
 */
export function recursiveRoutes(app: Hono, portRef: PortRef) {
	app.get('/recursive/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Recursive Top</title></head><body>' +
				'<a href="/recursive/page-a">Page A</a>' +
				'<a href="/recursive/page-b">Page B</a>' +
				'<a href="/recursive/page-c">Page C</a>' +
				'</body></html>',
		),
	);

	app.get('/recursive/page-a', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Page A</title></head><body>' +
				'<a href="/recursive/page-b">Page B</a>' +
				'<a href="/recursive/page-c">Page C</a>' +
				'</body></html>',
		),
	);

	app.get('/recursive/page-b', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Page B</title></head><body>' +
				'<a href="/recursive/page-c">Page C</a>' +
				`<a href="http://127.0.0.1:${portRef.port}/external-like">External Like</a>` +
				'</body></html>',
		),
	);

	app.get('/recursive/page-c', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Page C</title></head><body>' +
				'<p>End of chain</p>' +
				'</body></html>',
		),
	);

	app.get('/external-like', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>External Page</title></head><body></body></html>',
		),
	);
}
