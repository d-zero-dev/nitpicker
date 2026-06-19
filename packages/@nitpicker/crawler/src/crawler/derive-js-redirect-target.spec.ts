import { describe, expect, it } from 'vitest';

import { deriveJsRedirectTarget } from './derive-js-redirect-target.js';

describe('deriveJsRedirectTarget', () => {
	it('returns the post-navigation URL when it points to a different http(s) destination', () => {
		// The motivating real-world shape: a page returns 200 with an inline
		// `window.location.replace(...)` (either `<head>`-level or
		// `onload`-triggered). Puppeteer reports the destination via
		// `page.url()` after `page.goto()` returns null — we keep it as the
		// redirect target.
		expect(
			deriveJsRedirectTarget(
				'https://www.example.com/old',
				'https://www.example.com/new',
			),
		).toBe('https://www.example.com/new');
	});

	it('preserves a cross-origin JS-redirect destination', () => {
		// Same-origin is the common case but a JS redirect to a different host
		// is equally valid (think a deprecated landing page bouncing visitors
		// to the new product domain). Record the edge so the source row
		// reflects the actual landing point. (Scope-vs-policy decisions for
		// enqueuing the destination live at the call site in `#runDeal`, not
		// in this helper.)
		expect(
			deriveJsRedirectTarget('https://old.example.com/', 'https://new.example.org/'),
		).toBe('https://new.example.org/');
	});

	it('returns null when post-navigation URL is identical to the original', () => {
		// Identity means the navigation never moved past the original URL
		// (the throw fired in place). Treating this as a redirect would
		// create a self-loop in the pages table.
		expect(
			deriveJsRedirectTarget(
				'https://www.example.com/page',
				'https://www.example.com/page',
			),
		).toBeNull();
	});

	it('returns null when the only difference is a trailing slash', () => {
		// `https://host` vs `https://host/` — WHATWG URL parsing normalises
		// the authority-only form to include the trailing slash. Without
		// canonicalisation the rescue would record a phantom self-redirect
		// every time puppeteer reports the slashed form against a slash-less
		// `originalUrl`.
		expect(
			deriveJsRedirectTarget('https://www.example.com', 'https://www.example.com/'),
		).toBeNull();
	});

	it('returns null when the only difference is host case', () => {
		// Chromium lowercases hostnames; the source URL may carry mixed-case
		// (legacy anchors, internationalised-domain round-trips, manual seeds).
		// Canonicalise before comparing so a case-only diff is treated as
		// identity.
		expect(
			deriveJsRedirectTarget('https://Example.com/path', 'https://example.com/path'),
		).toBeNull();
	});

	it('returns null when the only difference is a default port', () => {
		// `https://host:443/` and `https://host/` are the same URL per
		// WHATWG. The canonical form drops the default port; a phantom
		// redirect would otherwise fire every time a Location header
		// explicitly carried the default port.
		expect(
			deriveJsRedirectTarget(
				'https://www.example.com:443/path',
				'https://www.example.com/path',
			),
		).toBeNull();
	});

	it('returns null when the only difference is a fragment', () => {
		// Fragments are not transmitted to the server and are not a
		// meaningful redirect distinction. Canonicalisation strips them.
		expect(
			deriveJsRedirectTarget(
				'https://www.example.com/p',
				'https://www.example.com/p#section',
			),
		).toBeNull();
	});

	it('returns null when the only difference is credentials on the original', () => {
		// `ExURL.withoutHashAndAuth` already strips credentials at the
		// call site, but defensively normalise here too — a future caller
		// passing `url.href` instead must not produce a phantom redirect.
		expect(
			deriveJsRedirectTarget(
				'https://user:pass@www.example.com/path',
				'https://www.example.com/path',
			),
		).toBeNull();
	});

	it('strips credentials and fragment from the returned destination', () => {
		// Pre-RFC 9110 servers can issue `Location: https://user:pass@host/path`
		// (still observed in legacy enterprise deployments). The rescue must
		// NOT persist credentials into the .nitpicker archive — same threat
		// model as the scope-auth-leak guard at the navigation side.
		expect(
			deriveJsRedirectTarget(
				'https://www.example.com/',
				'https://user:pass@www.example.com/dest#anchor',
			),
		).toBe('https://www.example.com/dest');
	});

	it('returns null for about:blank — the initial-page sentinel', () => {
		// `about:blank` is the value `page.url()` reports on a fresh
		// browser context that never advanced past `browser.newPage()`.
		// Recording it as a redirect destination would persist a
		// non-resolvable URL into the archive.
		expect(deriveJsRedirectTarget('https://www.example.com/', 'about:blank')).toBeNull();
	});

	it('returns null for chrome-error:// — the network-failure error page', () => {
		// When Chromium loads its own network-error UI the URL surfaces with
		// the `chrome-error://` scheme. That is a browser-internal state, not
		// a redirect target — we want the error to surface through the normal
		// `status = -1` path, not be papered over as a redirect.
		expect(
			deriveJsRedirectTarget('https://www.example.com/', 'chrome-error://chromewebdata/'),
		).toBeNull();
	});

	it('returns null for data: URLs — never a redirect destination we want to follow', () => {
		// Some sites bounce visitors through a `data:text/html,...` blob.
		// Persisting that base64 (or inline-HTML) body as a redirect target
		// would corrupt the pages table — drop it.
		expect(
			deriveJsRedirectTarget('https://www.example.com/', 'data:text/html,<h1>hi</h1>'),
		).toBeNull();
	});

	it('returns null for file: URLs — outside of any HTTP archive scope', () => {
		expect(
			deriveJsRedirectTarget('https://www.example.com/', 'file:///tmp/local.html'),
		).toBeNull();
	});

	it('returns null for javascript: URLs', () => {
		// `javascript:` href click can surface in `page.url()` in degenerate
		// cases. It is never a navigation destination we can crawl.
		expect(
			deriveJsRedirectTarget('https://www.example.com/', 'javascript:void(0)'),
		).toBeNull();
	});

	it('returns null when post-navigation URL is undefined (page.url() read failed)', () => {
		// `#launchBrowserAndScrape` passes `undefined` when reading
		// `page.url()` itself threw (target closed mid-throw). We want
		// the existing error path to take over, not a phantom redirect.
		expect(deriveJsRedirectTarget('https://www.example.com/')).toBeNull();
	});

	it('returns null when post-navigation URL is null', () => {
		expect(deriveJsRedirectTarget('https://www.example.com/', null)).toBeNull();
	});

	it('returns null for an empty string', () => {
		// `page.url()` on a brand-new context can momentarily return `''`
		// — defensively reject so we never write an empty URL to the archive.
		expect(deriveJsRedirectTarget('https://www.example.com/', '')).toBeNull();
	});

	it('returns null for a whitespace-only string', () => {
		expect(deriveJsRedirectTarget('https://www.example.com/', '   ')).toBeNull();
	});

	it('trims surrounding whitespace before processing the URL', () => {
		// Defence-in-depth: a future puppeteer or beholder bump might
		// surface URLs with trailing newlines. We accept the URL but
		// canonicalise to a clean form so the archive does not store
		// inconsistent strings.
		expect(
			deriveJsRedirectTarget(
				'https://www.example.com/old',
				'  https://www.example.com/new\n',
			),
		).toBe('https://www.example.com/new');
	});

	it('accepts http:// (insecure) destinations — needed for legacy/internal redirects', () => {
		// Some intranets still bounce visitors back to plain HTTP. We do
		// not gate on TLS here — the consumer is the archive, not a
		// security policy.
		expect(
			deriveJsRedirectTarget('https://www.example.com/', 'http://intranet.example/'),
		).toBe('http://intranet.example/');
	});

	it('canonicalises a mixed-case scheme (`HTTPS://`) to lowercase', () => {
		// `page.url()` always returns lowercase schemes in practice, but
		// the helper accepts mixed-case and normalises so the archive
		// stores a single canonical form.
		expect(
			deriveJsRedirectTarget('https://www.example.com/', 'HTTPS://www.example.com/new'),
		).toBe('https://www.example.com/new');
	});

	it('returns null for protocol-relative URLs (missing scheme)', () => {
		// `//host/path` cannot be a final `page.url()` value because the
		// browser always resolves the scheme. If it appears here it is a
		// degenerate input we should reject.
		expect(
			deriveJsRedirectTarget('https://www.example.com/', '//other.example/'),
		).toBeNull();
	});
});
