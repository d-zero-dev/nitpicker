import type { PortRef } from '../server.js';
import type { Context, Hono } from 'hono';

/**
 * A 1x1 transparent PNG used as the image payload.
 */
const PNG_1X1 = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
	'base64',
);

/**
 * A single observed request to one of the counted image endpoints.
 */
interface ObservedRequest {
	/** The HTTP method of the request (e.g., `"GET"`, `"HEAD"`). */
	method: string;
	/** The request path. */
	path: string;
}

/**
 * Requests observed by the counted image endpoints, in arrival order.
 * Exposed via `/resource-reuse/__stats` for E2E assertions.
 */
const observedRequests: ObservedRequest[] = [];

/**
 * Registers routes for testing the resource-reuse optimization: queued URLs
 * that were already captured as sub-resources during page rendering must not
 * receive a redundant HEAD pre-flight.
 *
 * Each image endpoint records the method of every incoming request so that
 * tests can assert exactly which requests were made.
 * @param app - The Hono application instance to register routes on.
 * @param portRef - Holder for the server's actual listening port, used to
 *   build the self-referencing "external" (127.0.0.1) URL below.
 */
export function resourceReuseRoutes(app: Hono, portRef: PortRef) {
	app.get('/resource-reuse/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Resource Reuse</title></head><body>' +
				// Reuse case: rendered as a sub-resource AND directly linked
				'<img src="/resource-reuse/counted.png" alt="counted" width="1" height="1">' +
				'<a href="/resource-reuse/counted.png">counted image</a>' +
				// Fallback case: directly linked only — never a sub-resource
				'<a href="/resource-reuse/uncounted.png">uncounted image</a>' +
				// Redirect case: sub-resource recorded as 301 — must fall back
				'<img src="/resource-reuse/redirected.png" alt="redirected" width="1" height="1">' +
				'<a href="/resource-reuse/redirected.png">redirected image</a>' +
				// External reuse case: 127.0.0.1 is a different hostname (= external
				// scope) but the same server — rendered AND directly linked
				`<img src="http://127.0.0.1:${portRef.port}/resource-reuse/ext.png" alt="external" width="1" height="1">` +
				`<a href="http://127.0.0.1:${portRef.port}/resource-reuse/ext.png">external image</a>` +
				'</body></html>',
		),
	);

	app.on(['GET', 'HEAD'], '/resource-reuse/counted.png', servePng);
	app.on(['GET', 'HEAD'], '/resource-reuse/uncounted.png', servePng);
	app.on(['GET', 'HEAD'], '/resource-reuse/ext.png', servePng);
	app.on(['GET', 'HEAD'], '/resource-reuse/redirected.png', (c) => {
		recordRequest(c);
		return c.redirect('/resource-reuse/actual.png', 301);
	});
	app.on(['GET', 'HEAD'], '/resource-reuse/actual.png', servePng);

	app.get('/resource-reuse/__stats', (c) => c.json(observedRequests));
	// Reset hook: the server instance is shared across all E2E files, so tests
	// must clear the log before crawling to keep their exact-match assertions
	// independent of earlier runs.
	app.delete('/resource-reuse/__stats', (c) => {
		observedRequests.length = 0;
		return c.json({ ok: true });
	});
}

/**
 * Record the incoming request and serve the 1x1 PNG payload.
 * @param c - The Hono request context.
 * @returns The PNG response.
 */
function servePng(c: Context) {
	recordRequest(c);
	return c.body(new Uint8Array(PNG_1X1), 200, {
		'Content-Type': 'image/png',
		'Content-Length': String(PNG_1X1.byteLength),
	});
}

/**
 * Append the request's method and path to the observed-request log.
 * @param c - The Hono request context.
 */
function recordRequest(c: Context) {
	observedRequests.push({
		method: c.req.method,
		path: new URL(c.req.url).pathname,
	});
}
