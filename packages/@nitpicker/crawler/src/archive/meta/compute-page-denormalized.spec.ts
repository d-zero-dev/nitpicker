import type { Meta } from '@d-zero/beholder';

import { describe, it, expect } from 'vitest';

import { computePageDenormalized } from './compute-page-denormalized.js';

/**
 * Builds a minimal valid {@link Meta} object with required fields populated.
 * @param overrides
 */
function makeMeta(overrides: Partial<Meta> = {}): Meta {
	return {
		title: 'Test',
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
		...overrides,
	};
}

describe('computePageDenormalized', () => {
	it('returns zero counts and empty CSV when no jsonLd or tags are present', () => {
		expect(computePageDenormalized(makeMeta())).toEqual({
			tag_count: 0,
			jsonld_count: 0,
			tags_providers_csv: '',
		});
	});

	it('sums jsonLd + speculationRules into jsonld_count', () => {
		const result = computePageDenormalized(
			makeMeta({
				jsonLd: [
					{ raw: '{}', parsed: {} },
					{ raw: '{}', parsed: {} },
				],
				speculationRules: [{ raw: '{}', parsed: {} }],
			}),
		);
		expect(result.jsonld_count).toBe(3);
	});

	it('counts every tag entry into tag_count', () => {
		const result = computePageDenormalized(
			makeMeta({
				tags: {
					detected: {},
					entries: [
						{ provider: 'A', categories: [], sources: [] },
						{ provider: 'B', categories: [], sources: [] },
					],
				},
			}),
		);
		expect(result.tag_count).toBe(2);
	});

	it('produces sorted unique providers in tags_providers_csv', () => {
		const result = computePageDenormalized(
			makeMeta({
				tags: {
					detected: {},
					entries: [
						{ provider: 'Google Tag Manager', categories: [], sources: [] },
						{ provider: 'Google Analytics 4', categories: [], sources: [] },
						{ provider: 'Google Tag Manager', categories: [], sources: [], id: 'GTM-2' },
					],
				},
			}),
		);
		expect(result.tags_providers_csv).toBe('Google Analytics 4,Google Tag Manager');
		expect(result.tag_count).toBe(3);
	});
});
