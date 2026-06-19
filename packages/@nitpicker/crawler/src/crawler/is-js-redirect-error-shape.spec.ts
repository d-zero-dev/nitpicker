import { describe, expect, it } from 'vitest';

import { isJsRedirectErrorShape } from './is-js-redirect-error-shape.js';

describe('isJsRedirectErrorShape', () => {
	it('returns true for the bare beholder error string', () => {
		// The exact string `scraper.scrapeStart` throws when
		// `await page.goto(...)` resolves to `null`. This is the most
		// important positive — if a future beholder bump renames the
		// throw, this test (plus the spec on the sentinel constant)
		// is what catches the silent rescue regression.
		expect(isJsRedirectErrorShape('The method Page.goto returned null')).toBe(true);
	});

	it('returns true when the sentinel is wrapped by an outer retry layer', () => {
		// `[Retried N times]` is the real prefix `@d-zero/shared/retry`'s
		// retryCall attaches to the last attempt's error after retry
		// exhaustion — same shape observed across crawl_errors in
		// production archives (see `classify-error-kind.spec.ts` which
		// pins this wrapper across multiple kinds). The rescue must
		// still classify so a goto-null wrapped by retry exhaustion
		// keeps triggering.
		expect(
			isJsRedirectErrorShape('[Retried 3 times] The method Page.goto returned null'),
		).toBe(true);
	});

	it('returns true when the sentinel sits inside a Scraper.#fetchData wrapper', () => {
		// `Scraper.#fetchData: gave up after 3 retries — ...` is the
		// beholder-level prefix that surfaces in `page_errors` (production
		// archives observed: `classify-error-kind.spec.ts:142` pins this
		// wrapper with `Race 180,000ms` body). Keep classifying so the
		// rescue still applies when the message passes through this
		// wrapper.
		expect(
			isJsRedirectErrorShape(
				'Scraper.#fetchData: gave up after 3 retries — The method Page.goto returned null',
			),
		).toBe(true);
	});

	it('returns false for navigation timeout errors', () => {
		// Navigation timeouts are puppeteer's `TimeoutError` —
		// not goto-null. Without this guard, a slow page that timed
		// out after a redirect-edge landed on `page.url()` would be
		// silently recorded as a JS-redirect, hiding the timeout.
		expect(isJsRedirectErrorShape('Navigation timeout of 60000 ms exceeded')).toBe(false);
		expect(isJsRedirectErrorShape('TimeoutError: ...')).toBe(false);
	});

	it('returns false for Target closed / Session closed', () => {
		// Both are puppeteer protocol-level failures that leave
		// `page.url()` indeterminate; the rescue should NOT paper
		// over them as a redirect.
		expect(isJsRedirectErrorShape('Protocol error (Page.reload): Target closed')).toBe(
			false,
		);
		expect(
			isJsRedirectErrorShape('Session closed. Most likely the page has been closed.'),
		).toBe(false);
	});

	it('returns false for connection-reset / ECONNRESET errors', () => {
		expect(isJsRedirectErrorShape('read ECONNRESET')).toBe(false);
		expect(isJsRedirectErrorShape('net::ERR_EMPTY_RESPONSE')).toBe(false);
	});

	it('returns false for TLS errors', () => {
		// TLS failures are permanent and explicitly excluded from
		// puppeteer retry by `PERMANENT_ERROR_KINDS`. A phantom
		// JS-redirect would mask the cert problem.
		expect(isJsRedirectErrorShape('net::ERR_CERT_DATE_INVALID')).toBe(false);
		expect(isJsRedirectErrorShape('Error: unable to verify the first certificate')).toBe(
			false,
		);
	});

	it('returns false for DNS errors', () => {
		expect(isJsRedirectErrorShape('getaddrinfo ENOTFOUND host.example.invalid')).toBe(
			false,
		);
	});

	it('returns false for null / undefined', () => {
		expect(isJsRedirectErrorShape(null)).toBe(false);
		expect(isJsRedirectErrorShape()).toBe(false);
	});

	it('returns false for empty string', () => {
		expect(isJsRedirectErrorShape('')).toBe(false);
	});

	it('is case-insensitive on the sentinel', () => {
		// Defence-in-depth: if a future beholder bump returns the
		// sentinel in mixed case (`page.goto Returned Null` from a
		// formatting refactor), the rescue still fires. The reverse
		// is also true — `PAGE.GOTO RETURNED NULL` from any tooling
		// that uppercases logs.
		expect(isJsRedirectErrorShape('the method page.goto returned null')).toBe(true);
		expect(isJsRedirectErrorShape('PAGE.GOTO RETURNED NULL')).toBe(true);
	});

	it('returns false for unrelated content that happens to contain "goto"', () => {
		// Substring matching could be over-eager. The marker
		// `Page.goto returned null` is specific enough that a
		// generic "goto" in unrelated text won't match.
		expect(isJsRedirectErrorShape('Cannot find module: goto-loop-helper')).toBe(false);
		expect(isJsRedirectErrorShape('Page.goto() is deprecated; use Page.goto2')).toBe(
			false,
		);
	});
});
