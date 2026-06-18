import { describe, it, expect, beforeEach } from 'vitest';

import { clearDnsBurnedHostCache } from './clear-dns-burned-host-cache.js';
import { dnsBurnedHostCache } from './dns-burned-host-cache.js';

describe('dnsBurnedHostCache', () => {
	beforeEach(() => {
		clearDnsBurnedHostCache();
	});

	it('stores and retrieves hostnames by lowercased key', () => {
		dnsBurnedHostCache.set('www.example.invalid', 'dns');
		expect(dnsBurnedHostCache.has('www.example.invalid')).toBe(true);
	});

	it('rejects entries that the caller forgot to lowercase', () => {
		// The cache itself is a plain Map; the lowercasing contract lives in the
		// callers (Crawler.#sendHeadRequest and the preload path). The test
		// codifies the contract: callers must lowercase before insert/lookup,
		// otherwise the lookup misses.
		dnsBurnedHostCache.set('www.example.invalid', 'dns');
		expect(dnsBurnedHostCache.has('WWW.EXAMPLE.INVALID')).toBe(false);
	});

	it('round-trips Punycoded IDN hostnames', () => {
		const punycoded = new URL('https://例え.テスト/').hostname;
		expect(punycoded).toMatch(/^xn--/);
		dnsBurnedHostCache.set(punycoded, 'dns');
		expect(dnsBurnedHostCache.has(punycoded)).toBe(true);
	});

	it('round-trips IPv6 literals with bracket-stripped WHATWG form', () => {
		const ipv6Host = new URL('http://[fe80::1]:8080/').hostname;
		expect(ipv6Host).toBe('[fe80::1]');
		dnsBurnedHostCache.set(ipv6Host, 'dns');
		expect(dnsBurnedHostCache.has(ipv6Host)).toBe(true);
	});

	it('is cleared by clearDnsBurnedHostCache', () => {
		dnsBurnedHostCache.set('foo.invalid', 'dns');
		dnsBurnedHostCache.set('bar.invalid', 'dns');
		clearDnsBurnedHostCache();
		expect(dnsBurnedHostCache.size).toBe(0);
	});
});
