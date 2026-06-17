import type { Meta } from '@d-zero/beholder';

import { describe, it, expect } from 'vitest';

import { deriveMetaExtras } from './derive-meta-extras.js';

/**
 * Builds a minimal valid {@link Meta} object with required fields populated.
 * Spec-local helper.
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

describe('deriveMetaExtras', () => {
	it('omits jsonLd, speculationRules, and tags (kept in dedicated tables)', () => {
		const result = deriveMetaExtras(
			makeMeta({
				jsonLd: [{ raw: '{}', parsed: {} }],
				speculationRules: [{ raw: '{}', parsed: {} }],
				tags: {
					detected: { Analytics: { 'Google Analytics 4': { ids: ['G-X'] } } },
					entries: [
						{ provider: 'Google Analytics 4', categories: ['Analytics'], sources: [] },
					],
				},
			}),
		);
		expect(result).not.toHaveProperty('jsonLd');
		expect(result).not.toHaveProperty('speculationRules');
		expect(result).not.toHaveProperty('tags');
	});

	it('omits _raw (debug-only)', () => {
		const meta = makeMeta();
		(meta as Meta & { _raw?: unknown })._raw = [{ kind: 'title', content: 'x' }];
		const result = deriveMetaExtras(meta);
		expect(result).not.toHaveProperty('_raw');
	});

	it('passes through every other Meta field including flat-covered ones', () => {
		// Plan: flat-column duplication is acceptable; the function is intentionally
		// permissive so new Meta fields auto-propagate without code change.
		const result = deriveMetaExtras(
			makeMeta({
				lang: 'ja',
				description: 'desc',
				referrer: { raw: 'no-referrer', noReferrer: true },
				geo: { region: 'JP' },
				apple: { mobileWebAppCapable: true },
			}),
		);
		expect(result.title).toBe('Test');
		expect(result.lang).toBe('ja');
		expect(result.description).toBe('desc');
		expect(result.referrer).toEqual({ raw: 'no-referrer', noReferrer: true });
		expect(result.geo).toEqual({ region: 'JP' });
		expect(result.apple).toEqual({ mobileWebAppCapable: true });
	});

	it('round-trips through JSON.stringify / JSON.parse without loss', () => {
		const result = deriveMetaExtras(
			makeMeta({
				viewport: { raw: 'width=device-width', width: 'device-width' },
			}),
		);
		const json = JSON.stringify(result);
		const parsed: unknown = JSON.parse(json);
		expect((parsed as { viewport?: unknown }).viewport).toEqual({
			raw: 'width=device-width',
			width: 'device-width',
		});
	});
});
