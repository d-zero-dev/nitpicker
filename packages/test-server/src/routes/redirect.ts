import type { Hono } from 'hono';

/**
 * Registers routes for testing HTTP redirect chains (301 and 302).
 * @param app - The Hono application instance to register routes on.
 */
export function redirectRoutes(app: Hono) {
	app.get('/redirect/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Redirect Top</title></head><body>' +
				'<a href="/redirect/start">Start redirect chain</a>' +
				'</body></html>',
		),
	);

	app.get('/redirect/start', (c) => c.redirect('/redirect/middle', 301));

	app.get('/redirect/middle', (c) => c.redirect('/redirect/dest', 302));

	app.get('/redirect/dest', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Redirect Destination</title></head><body>' +
				'<a href="/redirect/start">Back to start</a>' +
				'</body></html>',
		),
	);
}
