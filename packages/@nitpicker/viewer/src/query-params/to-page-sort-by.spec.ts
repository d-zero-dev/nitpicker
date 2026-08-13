import { describe, expect, it } from 'vitest';

import { toPageSortBy } from './to-page-sort-by.js';

describe('toPageSortBy', () => {
	it('returns undefined for missing input', () => {
		expect(toPageSortBy()).toBeUndefined();
	});

	it('returns undefined for empty string', () => {
		expect(toPageSortBy('')).toBeUndefined();
	});

	it('returns the narrowed value for every known sort field', () => {
		expect(toPageSortBy('url')).toBe('url');
		expect(toPageSortBy('status')).toBe('status');
		expect(toPageSortBy('title')).toBe('title');
	});

	it('returns the narrowed value for every main-content / scroll-height sort field', () => {
		expect(toPageSortBy('mainContentWordCount')).toBe('mainContentWordCount');
		expect(toPageSortBy('mainContentBodyWordCount')).toBe('mainContentBodyWordCount');
		expect(toPageSortBy('mainContentHeadingCount')).toBe('mainContentHeadingCount');
		expect(toPageSortBy('mainContentImageCount')).toBe('mainContentImageCount');
		expect(toPageSortBy('mainContentTableCount')).toBe('mainContentTableCount');
		expect(toPageSortBy('mainContentButtonCount')).toBe('mainContentButtonCount');
		expect(toPageSortBy('mainContentIframeCount')).toBe('mainContentIframeCount');
		expect(toPageSortBy('mainContentVideoCount')).toBe('mainContentVideoCount');
		expect(toPageSortBy('mainContentAudioCount')).toBe('mainContentAudioCount');
		expect(toPageSortBy('mainContentCanvasCount')).toBe('mainContentCanvasCount');
		expect(toPageSortBy('mainContentCustomElementCount')).toBe(
			'mainContentCustomElementCount',
		);
		expect(toPageSortBy('scrollHeightDesktop')).toBe('scrollHeightDesktop');
		expect(toPageSortBy('scrollHeightMobile')).toBe('scrollHeightMobile');
	});

	it('returns undefined for unknown values (silent drop)', () => {
		expect(toPageSortBy('bogus')).toBeUndefined();
		expect(toPageSortBy('URL')).toBeUndefined();
		expect(toPageSortBy('__proto__')).toBeUndefined();
	});
});
