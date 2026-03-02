import { describe, it, expect } from 'vitest';

import { buildPluginOverrides } from './build-plugin-overrides.js';

describe('buildPluginOverrides', () => {
	it('returns empty object when no flags are set', () => {
		const result = buildPluginOverrides({});
		expect(result).toEqual({});
	});

	it('builds search keywords override', () => {
		const result = buildPluginOverrides({
			searchKeywords: ['foo', 'bar'],
		});
		expect(result).toEqual({
			'@nitpicker/analyze-search': { keywords: ['foo', 'bar'] },
		});
	});

	it('builds search scope override', () => {
		const result = buildPluginOverrides({
			searchScope: 'main',
		});
		expect(result).toEqual({
			'@nitpicker/analyze-search': { scope: 'main' },
		});
	});

	it('builds combined search keywords and scope override', () => {
		const result = buildPluginOverrides({
			searchKeywords: ['keyword1'],
			searchScope: '.content',
		});
		expect(result).toEqual({
			'@nitpicker/analyze-search': {
				keywords: ['keyword1'],
				scope: '.content',
			},
		});
	});

	it('builds main content selector override', () => {
		const result = buildPluginOverrides({
			mainContentSelector: '#page-body',
		});
		expect(result).toEqual({
			'@nitpicker/analyze-main-contents': { mainContentSelector: '#page-body' },
		});
	});

	it('builds axe lang override', () => {
		const result = buildPluginOverrides({
			axeLang: 'ja',
		});
		expect(result).toEqual({
			'@nitpicker/analyze-axe': { lang: 'ja' },
		});
	});

	it('builds overrides for multiple plugins simultaneously', () => {
		const result = buildPluginOverrides({
			searchKeywords: ['test'],
			searchScope: 'article',
			mainContentSelector: '#main',
			axeLang: 'en',
		});
		expect(result).toEqual({
			'@nitpicker/analyze-search': {
				keywords: ['test'],
				scope: 'article',
			},
			'@nitpicker/analyze-main-contents': { mainContentSelector: '#main' },
			'@nitpicker/analyze-axe': { lang: 'en' },
		});
	});

	it('ignores undefined flags', () => {
		const result = buildPluginOverrides({
			searchKeywords: undefined,
			searchScope: undefined,
			mainContentSelector: undefined,
			axeLang: undefined,
		});
		expect(result).toEqual({});
	});
});
