import type { Hono } from 'hono';

import { basicAuth } from 'hono/basic-auth';

/**
 * Test routes for Basic auth whose password contains characters outside
 * the RFC 3986 userinfo set (`[`, `]`, `{`, `}`, `=`).
 *
 * The WHATWG URL parser percent-encodes those characters in the
 * `username` / `password` fields, so a crawler that forwards the fields
 * verbatim (to `page.authenticate()` or a raw `Authorization` header)
 * sends the wrong literal and never authenticates. These routes let the
 * E2E suite prove the crawler decodes before forwarding.
 *
 * Layout:
 *
 * - `GET /special-char-auth/` — Requires Basic auth matching the
 *   DECODED literal `char-user:pa]ss[wo{rd}=`; answers
 *   `401 + WWW-Authenticate: Basic` otherwise. On success, returns an
 *   HTML document linking to the sub page so the crawl exercises the
 *   scope-auth inheritance path too.
 * - `GET /special-char-auth/sub` — Same auth requirement, plain page.
 * @param app - The Hono application instance to register routes on.
 */
export function specialCharAuthRoutes(app: Hono) {
	app.use(
		'/special-char-auth/*',
		basicAuth({
			username: 'char-user',
			password: 'pa]ss[wo{rd}=',
			realm: 'special-char',
		}),
	);

	app.get('/special-char-auth/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Special Char Auth Top</title></head><body>' +
				'<a href="/special-char-auth/sub">Sub</a>' +
				'</body></html>',
		),
	);

	app.get('/special-char-auth/sub', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Special Char Auth Sub</title></head><body>' +
				'<p>Authenticated sub page</p>' +
				'</body></html>',
		),
	);
}
