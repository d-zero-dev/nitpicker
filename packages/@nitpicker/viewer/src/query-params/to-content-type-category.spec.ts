import { describe, it, expect } from 'vitest';

import { toContentTypeCategory } from './to-content-type-category.js';

describe('toContentTypeCategory', () => {
	it('returns undefined for missing input', () => {
		// Mirrors the convention of `toBoolean` / `toNumber` — an absent query
		// param drops the filter rather than imposing a default.
		expect(toContentTypeCategory()).toBeUndefined();
	});

	it('returns undefined for empty string', () => {
		// Hono's query() returns '' for keys present but empty (e.g. `?x=`); the
		// guard must treat that the same as missing.
		expect(toContentTypeCategory('')).toBeUndefined();
	});

	it('returns the narrowed value for every known category', () => {
		expect(toContentTypeCategory('html')).toBe('html');
		expect(toContentTypeCategory('pdf')).toBe('pdf');
		expect(toContentTypeCategory('image')).toBe('image');
		expect(toContentTypeCategory('css')).toBe('css');
		expect(toContentTypeCategory('javascript')).toBe('javascript');
		expect(toContentTypeCategory('json')).toBe('json');
		expect(toContentTypeCategory('xml')).toBe('xml');
		expect(toContentTypeCategory('font')).toBe('font');
		expect(toContentTypeCategory('audio')).toBe('audio');
		expect(toContentTypeCategory('video')).toBe('video');
		expect(toContentTypeCategory('archive')).toBe('archive');
		expect(toContentTypeCategory('text')).toBe('text');
		expect(toContentTypeCategory('other')).toBe('other');
		expect(toContentTypeCategory('unknown')).toBe('unknown');
	});

	it('returns undefined for unknown values (silent drop — would have crashed listPages before this guard)', () => {
		// The specific values are the kinds of strings a hostile or buggy client
		// could send to trigger the prototype-pollution / unknown-key dispatch
		// crash the bugfix is addressing.
		expect(toContentTypeCategory('jpeg')).toBeUndefined();
		expect(toContentTypeCategory('HTML')).toBeUndefined();
		expect(toContentTypeCategory('html ')).toBeUndefined();
		expect(toContentTypeCategory('__proto__')).toBeUndefined();
		expect(toContentTypeCategory('constructor')).toBeUndefined();
		expect(toContentTypeCategory('toString')).toBeUndefined();
	});
});
