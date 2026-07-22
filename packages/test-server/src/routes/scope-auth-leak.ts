import type { PortRef } from '../server.js';
import type { Hono } from 'hono';

/**
 * In-memory record of every `Authorization` header the external (scope-out)
 * endpoint received during a crawl. Module-level so each E2E test can read
 * its own writes after the crawl finishes.
 *
 * Reset via `POST /scope-auth-leak/reset` before each test.
 */
const externalReceivedAuthHeaders: (string | null)[] = [];

/**
 * Test routes for verifying that scope-injected credentials do NOT leak to
 * sub-resources fetched from a different origin (different hostname / port).
 *
 * Layout:
 *
 * - `GET /scope-auth-leak/main` — In-scope page. Returns
 *   `WWW-Authenticate: Basic realm="scope"` until the request carries the
 *   expected Authorization header for `scope-user:scope-pass`. On success,
 *   returns an HTML document that embeds an `<img>` pointing at the external
 *   asset on `127.0.0.1` (a different hostname in tests — the convention
 *   used elsewhere in `test-server` for off-scope hosts).
 * - `GET /scope-auth-leak/external-asset.png` — Off-scope endpoint.
 *   Records the inbound `Authorization` header verbatim, then always
 *   responds with `401 + WWW-Authenticate: Basic realm="external"`. The
 *   `<img>` load failing is irrelevant — the test only cares what header
 *   the request carried.
 * - `GET /scope-auth-leak/external-headers` — Inspector. Returns the
 *   recorded Authorization headers as JSON for the test to assert on.
 * - `POST /scope-auth-leak/reset` — Clears the recorded headers between tests.
 *
 * The scope cred is `scope-user:scope-pass`; its base64 is
 * `&lt;base64 of scope-user:scope-pass&gt;`. The leak test asserts that no recorded
 * Authorization header matches `Basic &lt;base64 of scope-user:scope-pass&gt;` — only
 * the safe empty fallback `Basic Og==` (`":"`) or no header at all should
 * have reached the external endpoint.
 * @param app - The Hono application instance to register routes on.
 * @param portRef - Holder for the server's actual listening port, used to
 *   build the self-referencing "external" (127.0.0.1) URL below.
 */
export function scopeAuthLeakRoutes(app: Hono, portRef: PortRef) {
	const expectedScopeAuth = 'Basic ' + btoa('scope-user:scope-pass');

	app.get('/scope-auth-leak/main', (c) => {
		const auth = c.req.header('authorization');
		if (auth !== expectedScopeAuth) {
			return c.body(null, 401, {
				'WWW-Authenticate': 'Basic realm="scope"',
			});
		}
		// Sub-resource URL points at `127.0.0.1` (different hostname from
		// `localhost` even though both resolve to 127.0.0.1) so the
		// crawler's scope map — keyed on hostname — treats it as off-scope.
		// An `<img>` is used instead of `<script>` because Chromium is more
		// likely to issue the request and process the 401 without holding
		// up the DOMContentLoaded race (a 401 on a script src is still
		// surfaced as a load failure, but the auth challenge fires on the
		// way to that failure either way — which is all the test needs).
		return c.html(
			'<!doctype html><html lang="en"><head><title>Scope Auth Leak Main</title></head><body>' +
				'<p>Scope main</p>' +
				`<img src="http://127.0.0.1:${portRef.port}/scope-auth-leak/external-asset.png" alt="external" width="1" height="1">` +
				'</body></html>',
		);
	});

	app.get('/scope-auth-leak/external-asset.png', (c) => {
		const auth = c.req.header('authorization');
		// Record every visit — including the very first 401-challenge
		// response, which puppeteer/Chromium will retry with whatever
		// Authorization header the auth handler installs. The test asserts
		// against the FULL list, not just the latest, so a leak on any
		// attempt counts.
		externalReceivedAuthHeaders.push(auth ?? null);
		return c.body(null, 401, {
			'WWW-Authenticate': 'Basic realm="external"',
		});
	});

	app.get('/scope-auth-leak/external-headers', (c) =>
		c.json({ headers: [...externalReceivedAuthHeaders] }),
	);

	app.post('/scope-auth-leak/reset', (c) => {
		externalReceivedAuthHeaders.length = 0;
		return c.body(null, 204);
	});
}
