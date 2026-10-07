import type { PortRef } from '../server.js';
import type { Hono, MiddlewareHandler } from 'hono';

/** The API key every protected in-scope endpoint demands. */
const REQUIRED_API_KEY = 'e2e-api-key';

/** One request the test-server observed. */
interface RecordedRequest {
	/** `Host` header — `localhost:PORT` is in scope, `127.0.0.1:PORT` is off-scope. */
	readonly host: string;
	readonly method: string;
	readonly path: string;
	readonly apiKey: string | null;
	readonly authorization: string | null;
}

/**
 * In-memory record of every request to `/request-headers/*`. Module-level so
 * each E2E test can read its own writes after the crawl; cleared by
 * `POST /request-headers/reset`.
 */
const recorded: RecordedRequest[] = [];

/**
 * Test routes for verifying that user-supplied request headers
 * (`requestHeaders`) reach in-scope requests and NEVER reach anything
 * off-scope.
 *
 * Layout (`localhost:PORT` is the scope; `127.0.0.1:PORT` is off-scope, the
 * `test-server` convention for an external host):
 *
 * - `GET /request-headers/` — In-scope entry page (the crawl root; a scope is a
 *   `(hostname, port, path)` triple, so the root must be a directory for its
 *   siblings below to be in scope). 401 unless `X-Api-Key`
 *   matches, so a 200 proves the header reached both the HEAD pre-flight and
 *   the browser navigation. Links to an in-scope protected page, an external
 *   page, and an in-scope URL that redirects off-scope; embeds an in-scope and
 *   an off-scope `<img>`.
 * - `GET /request-headers/inscope-page` — Protected in-scope page.
 * - `GET /request-headers/inscope-asset.png` — In-scope sub-resource; records
 *   the headers (proves the browser attaches them to in-scope sub-resources).
 * - `GET /request-headers/redirect-out` — In-scope URL answering 302 to the
 *   off-scope `external-landing`.
 * - `GET /request-headers/redirect-in` — In-scope URL answering 302 to the
 *   protected in-scope `inscope-landing` (the headers must survive this hop).
 * - `GET /request-headers/redirect-asset.png` — In-scope `<img>` answering 302
 *   to the off-scope `external-redirected-asset.png` (a browser-side redirect
 *   hop that must not carry the headers).
 * - `GET /request-headers/external-asset.png`, `external-page`,
 *   `external-landing` — Off-scope endpoints; record the headers they receive.
 * - `GET /request-headers/log` — Inspector, returns everything recorded.
 * - `POST /request-headers/reset` — Clears the record.
 * @param app - The Hono application instance to register routes on.
 * @param portRef - Holder for the server's actual listening port, used to
 *   build the self-referencing off-scope (127.0.0.1) URLs.
 */
export function requestHeadersRoutes(app: Hono, portRef: PortRef) {
	app.use('/request-headers/*', async (c, next) => {
		if (
			c.req.path !== '/request-headers/log' &&
			c.req.path !== '/request-headers/reset'
		) {
			recorded.push({
				host: c.req.header('host') ?? '',
				method: c.req.method,
				path: c.req.path,
				apiKey: c.req.header('x-api-key') ?? null,
				authorization: c.req.header('authorization') ?? null,
			});
		}
		await next();
	});

	const requireApiKey: MiddlewareHandler = async (c, next) => {
		if (c.req.header('x-api-key') !== REQUIRED_API_KEY) {
			return c.text('unauthorized', 401);
		}
		await next();
	};
	app.use('/request-headers/', requireApiKey);
	app.use('/request-headers/inscope-page', requireApiKey);
	app.use('/request-headers/inscope-landing', requireApiKey);

	app.get('/request-headers/', (c) => {
		const external = `http://127.0.0.1:${portRef.port}/request-headers`;
		return c.html(
			'<!doctype html><html lang="en"><head><title>Request Headers Main</title></head><body>' +
				'<p>main</p>' +
				'<a href="/request-headers/inscope-page">in-scope page</a>' +
				`<a href="${external}/external-page">external page</a>` +
				'<a href="/request-headers/redirect-out">redirects off-scope</a>' +
				'<a href="/request-headers/redirect-in">redirects in scope</a>' +
				'<img src="/request-headers/inscope-asset.png" alt="in" width="1" height="1">' +
				'<img src="/request-headers/redirect-asset.png" alt="redirected" width="1" height="1">' +
				`<img src="${external}/external-asset.png" alt="out" width="1" height="1">` +
				'</body></html>',
		);
	});

	app.get('/request-headers/inscope-page', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>In-scope page</title></head><body><p>in</p></body></html>',
		),
	);

	app.get('/request-headers/inscope-asset.png', (c) => c.body(null, 404));
	app.get('/request-headers/external-asset.png', (c) => c.body(null, 404));

	app.get('/request-headers/external-page', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>External page</title></head><body><p>out</p></body></html>',
		),
	);

	app.get('/request-headers/redirect-out', (c) =>
		c.redirect(`http://127.0.0.1:${portRef.port}/request-headers/external-landing`, 302),
	);

	app.get('/request-headers/redirect-in', (c) =>
		c.redirect('/request-headers/inscope-landing', 302),
	);

	app.get('/request-headers/inscope-landing', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>In-scope landing</title></head><body><p>landing</p></body></html>',
		),
	);

	app.get('/request-headers/redirect-asset.png', (c) =>
		c.redirect(
			`http://127.0.0.1:${portRef.port}/request-headers/external-redirected-asset.png`,
			302,
		),
	);

	app.get('/request-headers/external-redirected-asset.png', (c) => c.body(null, 404));

	app.get('/request-headers/external-landing', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>External landing</title></head><body><p>landing</p></body></html>',
		),
	);

	app.get('/request-headers/log', (c) => c.json({ requests: [...recorded] }));

	app.post('/request-headers/reset', (c) => {
		recorded.length = 0;
		return c.body(null, 204);
	});
}
