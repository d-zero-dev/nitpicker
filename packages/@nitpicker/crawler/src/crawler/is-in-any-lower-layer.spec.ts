import type { ParseURLOptions } from '@d-zero/shared/parse-url';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { describe, it, expect } from 'vitest';

import { isInAnyLowerLayer } from './is-in-any-lower-layer.js';

const defaultOptions: ParseURLOptions = {};

describe('isInAnyLowerLayer', () => {
	it('returns true when URL is in a lower layer of a scope', () => {
		const url = parseUrl('https://example.com/blog/post')!;
		const scopes = [parseUrl('https://example.com/blog/')!];
		expect(isInAnyLowerLayer(url, scopes, defaultOptions)).toBe(true);
	});

	it('returns false when URL is not in a lower layer', () => {
		const url = parseUrl('https://example.com/about')!;
		const scopes = [parseUrl('https://example.com/blog/')!];
		expect(isInAnyLowerLayer(url, scopes, defaultOptions)).toBe(false);
	});

	it('returns true when URL matches one of multiple scopes', () => {
		const url = parseUrl('https://example.com/docs/api')!;
		const scopes = [
			parseUrl('https://example.com/blog/')!,
			parseUrl('https://example.com/docs/')!,
		];
		expect(isInAnyLowerLayer(url, scopes, defaultOptions)).toBe(true);
	});
});
