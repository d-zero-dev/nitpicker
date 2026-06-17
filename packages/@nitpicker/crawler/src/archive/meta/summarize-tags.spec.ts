import type { TagRow } from './types.js';

import { describe, it, expect } from 'vitest';

import { summarizeTags } from './summarize-tags.js';

/**
 * Builds a {@link TagRow} with sensible defaults.
 * @param o
 */
function row(o: Partial<TagRow>): TagRow {
	return {
		id: 0,
		pageId: 0,
		provider: 'Test',
		category: null,
		externalId: null,
		version: null,
		confidence: null,
		categories: [],
		sources: [],
		...o,
	};
}

describe('summarizeTags', () => {
	it('returns empty summary for no rows', () => {
		expect(summarizeTags([])).toEqual({ count: 0, providerIds: {} });
	});

	it('groups external IDs by provider, sorted and deduplicated', () => {
		const result = summarizeTags([
			row({ provider: 'Google Tag Manager', externalId: 'GTM-Z' }),
			row({ provider: 'Google Tag Manager', externalId: 'GTM-A' }),
			row({ provider: 'Google Tag Manager', externalId: 'GTM-A' }),
			row({ provider: 'Google Analytics 4', externalId: 'G-1' }),
		]);
		expect(result.count).toBe(4);
		expect(result.providerIds).toEqual({
			'Google Analytics 4': ['G-1'],
			'Google Tag Manager': ['GTM-A', 'GTM-Z'],
		});
	});

	it('includes providers with no external IDs as empty arrays', () => {
		const result = summarizeTags([row({ provider: 'Custom', externalId: null })]);
		expect(result.providerIds).toEqual({ Custom: [] });
		expect(result.count).toBe(1);
	});

	it('sorts providers alphabetically in the output map', () => {
		const result = summarizeTags([
			row({ provider: 'Zebra' }),
			row({ provider: 'Alpha' }),
		]);
		expect(Object.keys(result.providerIds)).toEqual(['Alpha', 'Zebra']);
	});
});
