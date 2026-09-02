import { describe, it, expect } from 'vitest';

import { resolvePageListUrlFilter } from './resolve-page-list-url-filter.js';

/**
 * Builds a fake accessor whose `getConfig()` resolves with a fixed
 * `disableQueries` value, for testing normalization behavior.
 * @param disableQueries - The `disableQueries` value to return.
 */
function makeAccessor(disableQueries: boolean) {
	return { getConfig: () => Promise.resolve({ disableQueries }) } as never;
}

describe('resolvePageListUrlFilter', () => {
	it('normalizes every URL against the archive disableQueries setting', async () => {
		const { urls, unparseable } = await resolvePageListUrlFilter(makeAccessor(false), [
			'https://example.com/page?b=2&a=1',
		]);
		expect(urls).toEqual(['https://example.com/page?a=1&b=2']);
		expect(unparseable).toEqual([]);
	});

	it('separates unparseable inputs from normalized urls', async () => {
		const { urls, unparseable } = await resolvePageListUrlFilter(makeAccessor(false), [
			'https://example.com/page',
			'not a url',
			'mailto:test@example.com',
		]);
		expect(urls).toEqual(['https://example.com/page']);
		expect(unparseable).toEqual(['not a url', 'mailto:test@example.com']);
	});

	it('deduplicates URLs that normalize to the same form', async () => {
		const { urls } = await resolvePageListUrlFilter(makeAccessor(false), [
			'https://example.com/page?b=2&a=1',
			'https://example.com/page?a=1&b=2',
		]);
		expect(urls).toEqual(['https://example.com/page?a=1&b=2']);
	});

	it('returns empty urls and empty unparseable for an empty input list', async () => {
		const { urls, unparseable } = await resolvePageListUrlFilter(makeAccessor(false), []);
		expect(urls).toEqual([]);
		expect(unparseable).toEqual([]);
	});

	it('returns all inputs as unparseable when every URL is invalid', async () => {
		const { urls, unparseable } = await resolvePageListUrlFilter(makeAccessor(false), [
			'not a url',
		]);
		expect(urls).toEqual([]);
		expect(unparseable).toEqual(['not a url']);
	});
});
