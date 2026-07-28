import type { Hono } from 'hono';

/**
 * Registers routes for testing console-log / page-error capture (issue
 * #228): pages that emit `console` messages of every type, an uncaught
 * exception, and a shared warning repeated across two distinct pages (to
 * exercise cross-page dictionary dedup in `console_log_items`).
 * @param app - The Hono application instance to register routes on.
 */
export function consoleLogsRoutes(app: Hono) {
	// Without this, Chrome's own auto-requested `/favicon.ico` 404s and logs
	// a `console.error` ("Failed to load resource...") on every page — noise
	// that would otherwise land in `page_console_logs` for pages this suite
	// asserts have zero / an exact count of console entries.
	app.get('/favicon.ico', (c) => c.body(null, 204));

	app.get('/console-logs/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Console Logs Index</title></head><body>' +
				'<a href="/console-logs/mixed/">mixed</a>' +
				'<a href="/console-logs/error/">error</a>' +
				'<a href="/console-logs/shared-a/">shared-a</a>' +
				'<a href="/console-logs/silent/">silent</a>' +
				'</body></html>',
		),
	);

	app.get('/console-logs/mixed/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Console Logs Mixed</title></head><body>' +
				'<script>' +
				"console.log('hello from mixed');" +
				"console.warn('a warning', { code: 42 });" +
				"console.error('an error');" +
				'</script>' +
				'</body></html>',
		),
	);

	app.get('/console-logs/error/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Console Logs Error</title></head><body>' +
				"<script>throw new Error('boom from error page');</script>" +
				'</body></html>',
		),
	);

	// Both pages load the identical external script — the same shared
	// framework bundle firing the same `console.warn` at the same source
	// location on every page. The dictionary row it produces in
	// `console_log_items` must be shared, not duplicated. An inline
	// `<script>` per page would defeat this: beholder's captured
	// `location.url` is the *page* URL for inline scripts, so identical
	// inline text on two pages would still hash to two different rows.
	app.get('/console-logs/shared-a/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Console Logs Shared A</title></head><body>' +
				'<a href="/console-logs/shared-b/">to b</a>' +
				'<script src="/console-logs/shared.js"></script>' +
				'</body></html>',
		),
	);

	app.get('/console-logs/shared-b/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Console Logs Shared B</title></head><body>' +
				'<script src="/console-logs/shared.js"></script>' +
				'</body></html>',
		),
	);

	app.get('/console-logs/shared.js', (c) =>
		c.text("console.warn('shared framework warning');", 200, {
			'Content-Type': 'application/javascript',
		}),
	);

	app.get('/console-logs/silent/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Console Logs Silent</title></head><body>' +
				'no console output here' +
				'</body></html>',
		),
	);
}
