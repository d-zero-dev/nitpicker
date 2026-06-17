import { describe, it, expect } from 'vitest';

import { extractTagsForArchive } from './extract-tags-for-archive.js';

describe('extractTagsForArchive', () => {
	it('returns an empty array when no entries are present', () => {
		expect(extractTagsForArchive({ detected: {}, entries: [] })).toEqual([]);
	});

	it('flattens one entry per Wappalyzer detection', () => {
		const result = extractTagsForArchive({
			detected: {},
			entries: [
				{
					provider: 'Google Tag Manager',
					categories: ['Tag Managers', 'Analytics'],
					id: 'GTM-XXXXXXX',
					version: '1.0',
					confidence: 100,
					sources: [
						{ type: 'script-src', src: 'https://www.googletagmanager.com/gtm.js' },
					],
				},
				{
					provider: 'Google Analytics 4',
					categories: ['Analytics'],
					id: 'G-ABC123',
					sources: [{ type: 'inline', location: 'head' }],
				},
			],
		});
		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({
			provider: 'Google Tag Manager',
			category: 'Tag Managers',
			externalId: 'GTM-XXXXXXX',
			version: '1.0',
			confidence: 100,
			categories: ['Tag Managers', 'Analytics'],
		});
		expect(result[0]?.sources).toEqual([
			{ type: 'script-src', src: 'https://www.googletagmanager.com/gtm.js' },
		]);
		expect(result[1]).toMatchObject({
			provider: 'Google Analytics 4',
			category: 'Analytics',
			externalId: 'G-ABC123',
			version: null,
			confidence: null,
		});
	});

	it('sets category to null when categories is empty', () => {
		const result = extractTagsForArchive({
			detected: {},
			entries: [{ provider: 'Custom', categories: [], sources: [] }],
		});
		expect(result[0]?.category).toBeNull();
	});

	it('sets externalId to null when entry.id is missing', () => {
		const result = extractTagsForArchive({
			detected: {},
			entries: [{ provider: 'Custom', categories: ['Misc'], sources: [] }],
		});
		expect(result[0]?.externalId).toBeNull();
	});
});
