import type { ParseURLOptions } from '@d-zero/shared/parse-url';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { describe, it, expect } from 'vitest';

import { shouldSkipUrl } from './should-skip-url.js';

const defaultOptions: ParseURLOptions = {};

describe('shouldSkipUrl', () => {
	it('returns true when URL matches a glob exclude pattern', () => {
		const url = parseUrl('https://example.com/secret/page')!;
		expect(
			shouldSkipUrl({
				url,
				excludes: ['/secret/**/*'],
				excludeUrls: [],
				options: defaultOptions,
			}),
		).toBe(true);
	});

	it('returns true when URL matches a prefix exclude', () => {
		const url = parseUrl('https://example.com/admin/settings')!;
		expect(
			shouldSkipUrl({
				url,
				excludes: [],
				excludeUrls: ['https://example.com/admin/'],
				options: defaultOptions,
			}),
		).toBe(true);
	});

	it('returns false when URL matches neither', () => {
		const url = parseUrl('https://example.com/public/page')!;
		expect(
			shouldSkipUrl({
				url,
				excludes: ['/secret/**/*'],
				excludeUrls: ['https://example.com/admin/'],
				options: defaultOptions,
			}),
		).toBe(false);
	});

	it('returns false with empty exclude lists', () => {
		const url = parseUrl('https://example.com/page')!;
		expect(
			shouldSkipUrl({ url, excludes: [], excludeUrls: [], options: defaultOptions }),
		).toBe(false);
	});

	it('matches HTTP URL against HTTPS excludeUrls prefix', () => {
		const url = parseUrl('http://twitter.com/user')!;
		expect(
			shouldSkipUrl({
				url,
				excludes: [],
				excludeUrls: ['https://twitter.com'],
				options: defaultOptions,
			}),
		).toBe(true);
	});

	it('matches HTTPS URL against HTTP excludeUrls prefix', () => {
		const url = parseUrl('https://twitter.com/user')!;
		expect(
			shouldSkipUrl({
				url,
				excludes: [],
				excludeUrls: ['http://twitter.com'],
				options: defaultOptions,
			}),
		).toBe(true);
	});
});
