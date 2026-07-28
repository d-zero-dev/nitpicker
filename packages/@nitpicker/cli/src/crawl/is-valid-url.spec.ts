import { describe, it, expect } from 'vitest';

import { isValidUrl } from './is-valid-url.js';

describe('isValidUrl', () => {
	it('パース可能な URL には true を返す', () => {
		expect(isValidUrl('https://example.com/')).toBe(true);
	});

	it('パースできない文字列には false を返す', () => {
		expect(isValidUrl('not-a-url')).toBe(false);
	});

	it('空文字列には false を返す', () => {
		expect(isValidUrl('')).toBe(false);
	});

	it('スキームのみの文字列には false を返す', () => {
		expect(isValidUrl('https://')).toBe(false);
	});
});
