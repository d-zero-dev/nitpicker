import type { Hono } from 'hono';

/**
 *
 * @param app
 */
export function optionsRoutes(app: Hono) {
	app.get('/options/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Options Top</title></head><body>' +
				'<a href="/options/page-a?tab=1">Page A</a>' +
				'<a href="http://127.0.0.1:8010/options/external">External</a>' +
				'<a href="/options/data.json">Internal JSON</a>' +
				'<a href="http://127.0.0.1:8010/options/data.json">External JSON</a>' +
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
