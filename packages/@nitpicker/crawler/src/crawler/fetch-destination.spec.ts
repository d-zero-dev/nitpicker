import type { PageData } from '@d-zero/beholder';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { destinationCache } from './destination-cache.js';
import NetTimeoutError from './net-timeout-error.js';

beforeEach(() => {
	destinationCache.clear();
});

afterEach(() => {
	destinationCache.clear();
});

/**
 * Build a placeholder PageData for cache-shape tests. Only fields read by
 * the cache lookup path matter — everything else is filler.
 * @param url - URL string for the page.
 * @returns A PageData-shaped object.
 */
function dummyPageData(url: string): PageData {
	return {
		url: parseUrl(url)!,
		redirectPaths: [],
		isTarget: true,
		isExternal: false,
		status: 200,
		statusText: 'OK',
		contentType: 'text/html',
		contentLength: 0,
		responseHeaders: {},
		meta: {
			title: '',
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
		imageList: [],
		anchorList: [],
		html: '',
		isSkipped: false,
	};
}

describe('destinationCache contract relied on by fetchDestination', () => {
	it('keys on `url.withoutHash` so query strings are kept but the hash is not', () => {
		const url = parseUrl('https://example.com/path?q=1#fragment')!;
		const pageData = dummyPageData('https://example.com/path?q=1');

		destinationCache.set(url.withoutHash, pageData);

		expect(destinationCache.get('https://example.com/path?q=1')).toBe(pageData);
		expect(destinationCache.get('https://example.com/path?q=1#fragment')).toBeUndefined();
	});

	it('round-trips both PageData and Error values', () => {
		// fetchDestination caches negative outcomes (DNS / TLS / refused) so a
		// doomed URL does not re-pay the network cost N times. The Map shape
		// must support both halves of `PageData | Error` for that guarantee
		// to hold.
		destinationCache.set(
			'https://ok.example.com/',
			dummyPageData('https://ok.example.com/'),
		);
		destinationCache.set(
			'https://bad.example.com/',
			new Error('ENOTFOUND bad.example.com'),
		);

		const ok = destinationCache.get('https://ok.example.com/');
		expect(ok).not.toBeInstanceOf(Error);
		expect(ok && !(ok instanceof Error) && ok.status).toBe(200);

		const bad = destinationCache.get('https://bad.example.com/');
		expect(bad).toBeInstanceOf(Error);
		expect((bad as Error).message).toBe('ENOTFOUND bad.example.com');
	});
});

describe('NetTimeoutError is not cached by fetchDestination', () => {
	it('NetTimeoutError instances are recognised by `instanceof Error`', () => {
		// Sanity for the skip guard: `instanceof NetTimeoutError` and
		// `instanceof Error` must both be true so the cache write site can
		// distinguish race timeouts from other Errors.
		const error = new NetTimeoutError('https://slow.example.com/');
		expect(error).toBeInstanceOf(NetTimeoutError);
		expect(error).toBeInstanceOf(Error);
		expect(error.message).toBe('Timeout: https://slow.example.com/');
	});

	it('caching a NetTimeoutError directly is *technically* possible — fetchDestination must guard against it', () => {
		// The Map itself does not refuse NetTimeoutError values; the guard
		// lives in `fetchDestination` (line ~98). This test pins the contract
		// that the cache layer is a plain `Map<string, PageData | Error>` so
		// the only place capable of filtering race timeouts is the caller.
		// If a future refactor moves the guard into the cache, this test
		// updates with that move.
		const cacheKey = 'https://slow.example.com/';
		destinationCache.set(cacheKey, new NetTimeoutError(cacheKey));
		expect(destinationCache.get(cacheKey)).toBeInstanceOf(NetTimeoutError);
	});
});
