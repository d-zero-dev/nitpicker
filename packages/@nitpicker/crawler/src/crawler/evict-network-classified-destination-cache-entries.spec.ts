import type { PageData } from '@d-zero/beholder';

import { describe, it, expect } from 'vitest';

import { evictNetworkClassifiedDestinationCacheEntries } from './evict-network-classified-destination-cache-entries.js';

const fakePageData = { status: 200 } as unknown as PageData;

describe('evictNetworkClassifiedDestinationCacheEntries', () => {
	it('evicts an entry whose cached error classifies as dns', () => {
		const cache = new Map<string, PageData | Error>([
			['https://a.example/', new Error('getaddrinfo ENOTFOUND a.example')],
		]);
		evictNetworkClassifiedDestinationCacheEntries(cache);
		expect(cache.has('https://a.example/')).toBe(false);
	});

	it('evicts entries for every network-related kind', () => {
		const cache = new Map<string, PageData | Error>([
			['dns', new Error('getaddrinfo ENOTFOUND a.example')],
			['dns-transient', new Error('getaddrinfo EAI_AGAIN a.example')],
			['local-network', new Error('ERR_INTERNET_DISCONNECTED')],
			['connection-timeout', new Error('ETIMEDOUT')],
			['connection-reset', new Error('ECONNRESET')],
		]);
		evictNetworkClassifiedDestinationCacheEntries(cache);
		expect(cache.size).toBe(0);
	});

	it('does NOT evict a cached success (PageData)', () => {
		const cache = new Map<string, PageData | Error>([
			['https://a.example/', fakePageData],
		]);
		evictNetworkClassifiedDestinationCacheEntries(cache);
		expect(cache.get('https://a.example/')).toBe(fakePageData);
	});

	it('does NOT evict a site-specific cached error (tls / client-blocked / connection-refused)', () => {
		const cache = new Map<string, PageData | Error>([
			['tls', new Error('ERR_CERT_DATE_INVALID')],
			['client-blocked', new Error('ERR_BLOCKED_BY_CLIENT')],
			['connection-refused', new Error('ECONNREFUSED')],
		]);
		evictNetworkClassifiedDestinationCacheEntries(cache);
		expect(cache.size).toBe(3);
	});

	it('leaves an unrelated entry untouched while evicting a network-classified one', () => {
		const cache = new Map<string, PageData | Error>([
			['https://dead-site.example/', new Error('ERR_BLOCKED_BY_CLIENT')],
			['https://outage.example/', new Error('getaddrinfo ENOTFOUND outage.example')],
		]);
		evictNetworkClassifiedDestinationCacheEntries(cache);
		expect(cache.has('https://dead-site.example/')).toBe(true);
		expect(cache.has('https://outage.example/')).toBe(false);
	});

	it('is a no-op on an empty cache', () => {
		const cache = new Map<string, PageData | Error>();
		expect(() => evictNetworkClassifiedDestinationCacheEntries(cache)).not.toThrow();
		expect(cache.size).toBe(0);
	});
});
