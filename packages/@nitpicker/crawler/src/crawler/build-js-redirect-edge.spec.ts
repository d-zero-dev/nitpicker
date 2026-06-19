import type { PageData } from '@d-zero/beholder';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { describe, expect, it } from 'vitest';

import { buildJsRedirectEdge } from './build-js-redirect-edge.js';

const SOURCE_URL = parseUrl('https://www.example.com/source')!;
const HEAD_OK_RESULT: PageData = {
	url: SOURCE_URL,
	redirectPaths: [],
	isTarget: true,
	isExternal: false,
	status: 200,
	statusText: 'OK',
	contentType: 'text/html',
	contentLength: 1024,
	responseHeaders: { 'content-type': 'text/html' },
	meta: {
		title: 'HEAD-derived',
		jsonLd: [],
		speculationRules: [],
		tags: { detected: {}, entries: [] },
		others: {
			meta: {},
			property: {},
			httpEquiv: {},
			itemprop: {},
			link: [],
			script: [],
			iframe: [],
		},
		originTrial: [],
	},
	anchorList: [],
	imageList: [],
	html: '',
	isSkipped: false,
};

describe('buildJsRedirectEdge', () => {
	it('returns null when the error message is NOT the Page.goto-null sentinel', () => {
		// Rescue must not fire for unrelated browser failures (TLS,
		// timeout, target crash) — even when `page.url()` happens to
		// report a different URL after the throw.
		const result = buildJsRedirectEdge({
			url: SOURCE_URL,
			isExternal: false,
			errorMessage: 'Navigation timeout of 60000 ms exceeded',
			postNavigationUrl: 'https://www.example.com/some-other',
			headCheckResult: HEAD_OK_RESULT,
		});
		expect(result).toBeNull();
	});

	it('returns null when postNavigationUrl is undefined', () => {
		// `#launchBrowserAndScrape` passes `undefined` when reading
		// `page.url()` itself threw (target closed mid-error). Without
		// a destination there is nothing to record.
		const result = buildJsRedirectEdge({
			url: SOURCE_URL,
			isExternal: false,
			errorMessage: 'The method Page.goto returned null',
			postNavigationUrl: undefined,
			headCheckResult: HEAD_OK_RESULT,
		});
		expect(result).toBeNull();
	});

	it('returns null when postNavigationUrl is the same URL as the source', () => {
		// `deriveJsRedirectTarget` rejects identity even after WHATWG
		// canonicalisation, so the rescue does not create a self-loop.
		const result = buildJsRedirectEdge({
			url: SOURCE_URL,
			isExternal: false,
			errorMessage: 'The method Page.goto returned null',
			postNavigationUrl: 'https://www.example.com/source',
			headCheckResult: HEAD_OK_RESULT,
		});
		expect(result).toBeNull();
	});

	it('builds a redirect-edge from a HEAD-success result when the sentinel matches', () => {
		// HEAD-success-then-puppeteer-fail path: the synthesised
		// PageData carries the HEAD-derived status (200) and content
		// type. The new `redirectPaths` is the single JS target.
		const result = buildJsRedirectEdge({
			url: SOURCE_URL,
			isExternal: false,
			errorMessage: 'The method Page.goto returned null',
			postNavigationUrl: 'https://www.example.com/destination',
			headCheckResult: HEAD_OK_RESULT,
		});
		expect(result).not.toBeNull();
		expect(result!.type).toBe('redirect-edge');
		expect(result!.source).toBe('js-redirect');
		expect(result!.pageData.status).toBe(200);
		expect(result!.pageData.statusText).toBe('OK');
		expect(result!.pageData.contentType).toBe('text/html');
		expect(result!.pageData.redirectPaths).toEqual([
			'https://www.example.com/destination',
		]);
	});

	it('builds a synthesised redirect-edge when no HEAD result is supplied', () => {
		// HEAD-fail-then-puppeteer-fallback path: HEAD itself died, so
		// the rescue starts from a `linkToPageData` placeholder. The
		// status is -1 with the original HEAD error message preserved
		// in statusText — `#linkRedirectSources` will later flip the
		// row to 301 because NULL/-1 satisfies its stamp predicate.
		const result = buildJsRedirectEdge({
			url: SOURCE_URL,
			isExternal: false,
			errorMessage: 'The method Page.goto returned null',
			postNavigationUrl: 'https://www.example.com/destination',
			// headCheckResult intentionally omitted to exercise the
			// fallback branch.
		});
		expect(result).not.toBeNull();
		expect(result!.type).toBe('redirect-edge');
		expect(result!.source).toBe('js-redirect');
		expect(result!.pageData.status).toBe(-1);
		expect(result!.pageData.redirectPaths).toEqual([
			'https://www.example.com/destination',
		]);
		// `linkToPageData` populates Meta with all the required slots
		// — verify a couple to catch a future bump that adds a field
		// without updating `linkToPageData`.
		expect(result!.pageData.meta.jsonLd).toEqual([]);
		expect(result!.pageData.meta.tags).toEqual({ detected: {}, entries: [] });
	});

	it('uses the errorMessage as statusText on the synthesised PageData when no HEAD result', () => {
		// The HEAD error's text is the most useful diagnostic for an
		// operator inspecting the archive — preserve it in the synthetic
		// row's statusText.
		const result = buildJsRedirectEdge({
			url: SOURCE_URL,
			isExternal: false,
			errorMessage: 'The method Page.goto returned null',
			postNavigationUrl: 'https://www.example.com/destination',
		});
		expect(result!.pageData.statusText).toBe('The method Page.goto returned null');
	});

	it('classifies via the wrapped sentinel form (retryCall wrapper)', () => {
		// `[Retried N times]` is the real prefix `@d-zero/shared/retry`'s
		// retryCall attaches after retry exhaustion (see
		// `is-js-redirect-error-shape.spec.ts` for the matrix). The
		// rescue must still classify so a wrapped goto-null keeps
		// triggering.
		const result = buildJsRedirectEdge({
			url: SOURCE_URL,
			isExternal: false,
			errorMessage: '[Retried 3 times] The method Page.goto returned null',
			postNavigationUrl: 'https://www.example.com/destination',
			headCheckResult: HEAD_OK_RESULT,
		});
		expect(result).not.toBeNull();
		expect(result!.source).toBe('js-redirect');
	});

	it('strips credentials from a credentialed JS-redirect target', () => {
		// `Location: https://user:pass@host/path` is rare but legal in
		// pre-RFC servers. `deriveJsRedirectTarget` strips credentials
		// (the rescue must not persist them into the archive).
		const result = buildJsRedirectEdge({
			url: SOURCE_URL,
			isExternal: false,
			errorMessage: 'The method Page.goto returned null',
			postNavigationUrl: 'https://user:pass@www.example.com/destination',
			headCheckResult: HEAD_OK_RESULT,
		});
		expect(result).not.toBeNull();
		expect(result!.pageData.redirectPaths).toEqual([
			'https://www.example.com/destination',
		]);
	});

	it('preserves isExternal when no HEAD result is supplied', () => {
		// External source classification must survive the rescue.
		const externalUrl = parseUrl('https://other-host.example/path')!;
		const result = buildJsRedirectEdge({
			url: externalUrl,
			isExternal: true,
			errorMessage: 'The method Page.goto returned null',
			postNavigationUrl: 'https://other-host.example/new',
		});
		expect(result).not.toBeNull();
		expect(result!.pageData.isExternal).toBe(true);
		expect(result!.pageData.isTarget).toBe(false);
	});

	it('returns null when errorMessage is null / undefined', () => {
		// Defensive: an absent error message means we have no signal
		// the failure was the goto-null shape — fall through.
		expect(
			buildJsRedirectEdge({
				url: SOURCE_URL,
				isExternal: false,
				errorMessage: null,
				postNavigationUrl: 'https://www.example.com/destination',
				headCheckResult: HEAD_OK_RESULT,
			}),
		).toBeNull();
		expect(
			buildJsRedirectEdge({
				url: SOURCE_URL,
				isExternal: false,
				errorMessage: undefined,
				postNavigationUrl: 'https://www.example.com/destination',
				headCheckResult: HEAD_OK_RESULT,
			}),
		).toBeNull();
	});

	it('returns null for non-http(s) post-navigation URLs (about:blank, chrome-error://)', () => {
		// `deriveJsRedirectTarget` rejects browser-internal schemes —
		// the rescue must not paper over an error page as a redirect.
		expect(
			buildJsRedirectEdge({
				url: SOURCE_URL,
				isExternal: false,
				errorMessage: 'The method Page.goto returned null',
				postNavigationUrl: 'about:blank',
				headCheckResult: HEAD_OK_RESULT,
			}),
		).toBeNull();
		expect(
			buildJsRedirectEdge({
				url: SOURCE_URL,
				isExternal: false,
				errorMessage: 'The method Page.goto returned null',
				postNavigationUrl: 'chrome-error://chromewebdata/',
				headCheckResult: HEAD_OK_RESULT,
			}),
		).toBeNull();
	});
});
