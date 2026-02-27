import type { Hono } from 'hono';

/**
 *
 * @param app
 */
export function recursiveRoutes(app: Hono) {
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
				'<a href="http://127.0.0.1:8010/external-like">External Like</a>' +
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
