import { describe, expect, it } from 'vitest';

import { convertLegacyPageTagsToInserts } from './convert-legacy-page-tags-to-inserts.js';

describe('convertLegacyPageTagsToInserts', () => {
	it('returns empty arrays for no rows', () => {
		expect(convertLegacyPageTagsToInserts([])).toEqual({
			signalInserts: [],
			technologyInserts: [],
		});
	});

	it('converts one row per page into a signal and a technology insert', () => {
		const { signalInserts, technologyInserts } = convertLegacyPageTagsToInserts([
			{
				pageId: 1,
				provider: 'Vue.js',
				version: '3.4.0',
				confidence: 100,
				categories: [],
			},
		]);
		expect(signalInserts).toEqual([
			{
				pageId: 1,
				technology: 'Vue',
				signalType: 'wappalyzer',
				evidence: 'Vue.js',
				weight: 100,
			},
		]);
		expect(technologyInserts).toEqual([
			{
				pageId: 1,
				technology: 'Vue',
				category: null,
				version: '3.4.0',
				confidence: 100,
				signalCount: 1,
			},
		]);
	});

	it('keeps a low-confidence detection that a fresh-crawl threshold would drop', () => {
		const { technologyInserts } = convertLegacyPageTagsToInserts([
			{ pageId: 1, provider: 'Some CMS', version: null, confidence: 20, categories: [] },
		]);
		expect(technologyInserts).toEqual([
			expect.objectContaining({ technology: 'Some CMS', confidence: 20 }),
		]);
	});

	it('groups rows by pageId independently', () => {
		const { signalInserts } = convertLegacyPageTagsToInserts([
			{ pageId: 1, provider: 'Vue.js', version: null, confidence: 60, categories: [] },
			{ pageId: 2, provider: 'React', version: null, confidence: 60, categories: [] },
		]);
		expect(signalInserts.map((s) => s.pageId)).toEqual([1, 2]);
	});
});
