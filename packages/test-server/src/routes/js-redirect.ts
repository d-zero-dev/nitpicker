import type { Hono } from 'hono';

/**
 * Registers routes that exercise the JS-redirect rescue path in
 * `Crawler.#scrapePage`.
 *
 * The motivating real-world shape: a server returns `200 OK` whose body
 * triggers a client-side `window.location.replace(...)` (or
 * `<meta http-equiv="refresh">`). Puppeteer's `page.goto()` resolves to
 * `null` once the JS-driven navigation supersedes the original, and the
 * scraper throws `The method Page.goto returned null`. Before the rescue
 * was added, the source URL was persisted as `status = -1` and `--retry-failed`
 * never converged because `Page.goto returned null` classifies as `protocol`
 * — neither permanent nor a puppeteer-fallback kind.
 *
 * With the rescue, `#scrapePage` reads `page.url()` from the still-alive
 * puppeteer page, derives the JS-redirect target, and records the source
 * as a redirect edge so the row reads as "200 OK + redirected via JS".
 *
 * Routes:
 * - `/js-redirect/` — entry point linking to the source.
 * - `/js-redirect/source` — returns 200 OK with an inline
 *   `window.location.replace('/js-redirect/dest')` fired from
 *   `onload` (mirrors the production case observed on a customer
 *   archive that motivated this rescue).
 * - `/js-redirect/dest` — the rendered destination.
 * @param app - The Hono application instance to register routes on.
 */
export function jsRedirectRoutes(app: Hono) {
	app.get('/js-redirect/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>JS Redirect Top</title></head><body>' +
				'<a href="/js-redirect/source">JS redirect source</a>' +
				'</body></html>',
		),
	);

	// Returns 200 OK with a head-level inline script that fires
	// `window.location.replace(...)` while the document is still parsing.
	// What puppeteer does with this is version-dependent: some versions
	// throw `Page.goto returned null` (which triggers the rescue path the
	// E2E was originally written for), others follow the JS navigation and
	// return the destination's response (the rescue path is bypassed but
	// beholder's normal redirect handling records the same archive shape).
	// The E2E in `js-redirect.e2e.ts` documents this dependency and asserts
	// the *archive outcome* (source row = 301 redirect, dest = 200 rendered)
	// rather than the specific code path that produced it. Rescue-path
	// logic is pinned at the unit level (`derive-js-redirect-target.spec.ts`
	// + `is-js-redirect-error-shape.spec.ts`).
	app.get('/js-redirect/source', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>JS Redirect Source</title>' +
				'<script>window.location.replace("/js-redirect/dest");</script>' +
				'</head><body>' +
				'<p>Bouncing to destination…</p>' +
				'</body></html>',
		),
	);

	app.get('/js-redirect/dest', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>JS Redirect Destination</title></head><body>' +
				'<a href="/js-redirect/">Back to top</a>' +
				'</body></html>',
		),
	);
}
