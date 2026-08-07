import type { Hono } from 'hono';

import { basicAuth } from 'hono/basic-auth';

/**
 * Test routes for Basic auth with a legal EMPTY password
 * (`http://user:@host/`).
 *
 * The crawler's URL type rounds an empty userinfo component to `null`,
 * so a "both username AND password present" guard on the HEAD
 * pre-flight would silently skip authentication for these URLs while
 * the browser path still authenticates — and for non-HTML content the
 * browser never runs, making the unauthenticated HEAD's 401 the page's
 * final recorded status. These routes let the E2E suite prove both
 * fetch paths authenticate.
 *
 * Layout:
 *
 * - `GET /empty-password-auth/` — Requires `emptypass-user:` (empty
 *   password); answers `401 + WWW-Authenticate: Basic` otherwise. On
 *   success, returns an HTML document linking to the text resource.
 * - `GET /empty-password-auth/note.txt` — Same auth requirement,
 *   `text/plain`. Non-HTML on purpose: its status is decided by the
 *   HEAD pre-flight alone, isolating that path from the browser's
 *   `page.authenticate` fallback.
 * @param app - The Hono application instance to register routes on.
 */
export function emptyPasswordAuthRoutes(app: Hono) {
	app.use(
		'/empty-password-auth/*',
		basicAuth({ username: 'emptypass-user', password: '', realm: 'empty-pass' }),
	);

	app.get('/empty-password-auth/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Empty Password Auth Top</title></head><body>' +
				'<a href="/empty-password-auth/note.txt">Note</a>' +
				'</body></html>',
		),
	);

	app.get('/empty-password-auth/note.txt', (c) => c.text('authenticated note'));
}
