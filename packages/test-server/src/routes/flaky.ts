import type { Hono } from 'hono';

/** Whether `/flaky/recoverable` is currently healed (serves 200) or failing (500). */
let healed = false;

/**
 * Registers routes that simulate a transient (recoverable) crawl failure for
 * exercising `crawl --retry-failed`.
 *
 * `/flaky/recoverable` returns `500` until `/flaky/control/heal` is hit, after
 * which it returns `200` and exposes a child link (`/flaky/healed-child`) that
 * is undiscoverable while the page is failing. The healed/failing state lives
 * in a module variable so an E2E test can flip it over HTTP between the
 * baseline crawl and the retry, independent of process boundaries.
 * @param app - The Hono application instance to register routes on.
 */
export function flakyRoutes(app: Hono) {
	app.get('/flaky/control/heal', (c) => {
		healed = true;
		return c.text('healed');
	});

	app.get('/flaky/control/reset', (c) => {
		healed = false;
		return c.text('reset');
	});

	app.get('/flaky/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Flaky Top</title></head><body>' +
				'<a href="/flaky/recoverable">Recoverable</a>' +
				'</body></html>',
		),
	);

	app.get('/flaky/recoverable', (c) =>
		healed
			? c.html(
					'<!doctype html><html lang="en"><head><title>Recovered</title></head><body>' +
						'<a href="/flaky/healed-child">Healed Child</a>' +
						'</body></html>',
				)
			: c.html(
					'<!doctype html><html lang="en"><head><title>Server Error</title></head><body>' +
						'<p>temporary failure</p>' +
						'</body></html>',
					500,
				),
	);

	app.get('/flaky/healed-child', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Healed Child</title></head><body>' +
				'<p>only reachable after the recoverable page heals</p>' +
				'</body></html>',
		),
	);
}
