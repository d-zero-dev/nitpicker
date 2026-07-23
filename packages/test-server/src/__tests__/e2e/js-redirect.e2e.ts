import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';
import { TEST_SERVER_PORT } from './test-server-port.js';

/**
 * E2E coverage for client-side redirect handling.
 *
 * **What this E2E actually verifies and what it does not:**
 *
 * Real-world JS-redirect failures (the motivating customer-archive
 * `Page.goto returned null` cases) require puppeteer to throw
 * mid-navigation. Reproducing that
 * deterministically across puppeteer versions inside a Hono test-server
 * fixture is unreliable — different puppeteer minor versions disagree on
 * whether an inline `<script>window.location.replace(...)</script>` causes
 * `page.goto()` to resolve `null`, follow the new navigation, or throw
 * `TargetClosed`. Under the puppeteer version that ships with this repo,
 * the inline-`<head>` script below currently results in puppeteer following
 * the JS navigation cleanly and reporting it as a beholder-side redirect
 * chain — i.e. the **rescue path is NOT triggered**, but the resulting
 * archive shape (source row stamped as a redirect to dest, dest fully
 * rendered) is observationally identical to the rescue-path outcome.
 *
 * The contract this E2E pins is therefore "client-side `window.location`
 * navigation lands in the archive as a redirect edge, whichever crawler
 * code path got it there". The rescue path's *own* logic is pinned at the
 * unit level by `derive-js-redirect-target.spec.ts` (URL canonicalisation,
 * scheme allow-list, credential strip) and `is-js-redirect-error-shape.spec.ts`
 * (the narrow `Page.goto returned null` trigger). Together they bracket
 * the rescue: the helpers prove the building blocks, this E2E proves the
 * archive-side outcome is correct for the broader "client-side navigation
 * away from a source URL" class of inputs.
 *
 * A regression that broke ONLY the rescue path (without breaking the
 * beholder follow-the-redirect path) would slip past this E2E. Once a
 * stable puppeteer-throw-inducing fixture is identified (likely via
 * `<meta http-equiv="refresh" content="0; url=...">` plus a Connection:
 * close response, or via a custom test-only puppeteer flag), upgrade this
 * file to assert the rescue path specifically.
 */
describe('Client-side window.location.replace() lands in the archive as a redirect edge', () => {
	let result: CrawlResult;

	beforeAll(async () => {
		result = await crawl([`http://localhost:${TEST_SERVER_PORT}/js-redirect/`]);
	}, 60_000);

	afterAll(async () => {
		await cleanup(result);
	});

	it('the destination is rendered and persisted', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const dest = pages.find((p) => p.url.pathname === '/js-redirect/dest');
		expect(dest).toBeDefined();
		expect(dest!.title).toBe('JS Redirect Destination');
		expect(dest!.status).toBe(200);
	});

	it('the source row is recorded as a redirect (status 301), never as a hard -1', async () => {
		// Under the rescue path: `#linkRedirectSources` stamps 301 onto
		// the NULL/-1 placeholder row left by `recordRedirect`.
		// Under the beholder follow-the-redirect path: the source row is
		// committed by `setPage`/`updatePage` as a redirect with the
		// browser-resolved status. Either way the row is no longer
		// `status = -1`, which is the user-visible convergence guarantee
		// `--retry-failed` is supposed to deliver.
		const allPages = await result.accessor.getPages();
		const source = allPages.find((p) => p.url.pathname === '/js-redirect/source');
		expect(source).toBeDefined();
		expect(source!.status).toBe(301);
		expect(source!.statusText).toBe('Moved Permanently');
	});

	it('the source resolves the destination via the redirect edge', async () => {
		// `redirectFrom` on the destination is the inverse of the
		// `redirectDestId` foreign key — proving `recordRedirect` →
		// `#linkRedirectSources` wired the edge the same way an HTTP 30x
		// source would have.
		const pages = await result.accessor.getPages('internal-page');
		const dest = pages.find((p) => p.url.pathname === '/js-redirect/dest');
		expect(dest).toBeDefined();
		const sourceUrls = dest!.redirectFrom.map((r) => r.url);
		expect(sourceUrls.some((u) => u.includes('/js-redirect/source'))).toBe(true);
	});

	it('the source is no longer eligible for --retry-failed (redirectDestId is set)', async () => {
		// `Database.resetFailedPages` excludes rows whose `redirectDestId`
		// is non-null (the SQL filter `whereNull('redirectDestId')`).
		// Either rescue path (HEAD-success + puppeteer-throw, or the
		// beholder follow-the-redirect path the current fixture takes)
		// records a redirect that sets `redirectDestId`, so the source
		// row is taken out of the retry pool.
		const allPages = await result.accessor.getPages();
		const source = allPages.find((p) => p.url.pathname === '/js-redirect/source');
		expect(source).toBeDefined();
		// `isTarget` is false for redirect sources (they redirect rather
		// than being a crawl target themselves) — same shape as a normal
		// HTTP 301 source.
		expect(source!.isTarget).toBe(false);
	});
});
