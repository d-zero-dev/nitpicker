import type { Hono } from 'hono';

/**
 *
 * @param app
 */
export function errorStatusRoutes(app: Hono) {
	app.get('/error-status/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Error Status Top</title></head><body>' +
				'<a href="/error-status/not-found">Not Found</a>' +
				'<a href="/error-status/server-error">Server Error</a>' +
				'<a href="/error-status/forbidden">Forbidden</a>' +
				'<a href="/error-status/normal">Normal</a>' +
				'</body></html>',
		),
	);

	app.get('/error-status/not-found', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Not Found</title></head><body>' +
				'<p>Page not found</p>' +
				'</body></html>',
			404,
		),
	);

	app.get('/error-status/server-error', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Server Error</title></head><body>' +
				'<p>Internal server error</p>' +
				'</body></html>',
			500,
		),
	);

	app.get('/error-status/forbidden', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Forbidden</title></head><body>' +
				'<p>Access denied</p>' +
				'</body></html>',
			403,
		),
	);

	app.get('/error-status/normal', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Normal Page</title></head><body>' +
				'<p>Normal content</p>' +
				'</body></html>',
		),
	);
}
