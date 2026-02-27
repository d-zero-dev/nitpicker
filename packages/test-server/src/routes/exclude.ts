import type { Hono } from 'hono';

/**
 *
 * @param app
 */
export function excludeRoutes(app: Hono) {
	app.get('/exclude/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Exclude Top</title></head><body>' +
				'<a href="/exclude/page-a">Page A</a>' +
				'<a href="/exclude/page-b">Page B</a>' +
				'<a href="/exclude/secret/hidden">Secret</a>' +
				'</body></html>',
		),
	);

	app.get('/exclude/page-a', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Exclude Page A</title></head><body>' +
				'<p>Normal page A</p>' +
				'</body></html>',
		),
	);

	app.get('/exclude/page-b', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Exclude Page B</title></head><body>' +
				'<p>This page contains FORBIDDEN_KEYWORD in its body.</p>' +
				'</body></html>',
		),
	);

	app.get('/exclude/secret/hidden', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Secret Hidden</title></head><body>' +
				'<p>This page is in the secret directory.</p>' +
				'</body></html>',
		),
	);
}
