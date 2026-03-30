import { describe, it, expect } from 'vitest';

import { getJSON } from './get-json.js';

describe('getJSON', () => {
	it('parses a valid JSON string', () => {
		expect(getJSON('["a","b"]', [])).toEqual(['a', 'b']);
	});

	it('parses a valid JSON object string', () => {
		expect(getJSON('{"key":"value"}', {})).toEqual({ key: 'value' });
	});

	it('returns fallback for invalid JSON string', () => {
		expect(getJSON('{invalid}', ['default'])).toEqual(['default']);
	});

	it('returns fallback for non-string input (number)', () => {
		expect(getJSON(42, 'fallback')).toBe('fallback');
	});

	it('returns fallback for non-string input (null)', () => {
		expect(getJSON(null, 'fallback')).toBe('fallback');
	});

	it('returns fallback for non-string input (undefined)', () => {
		expect(getJSON(undefined, 'fallback')).toBe('fallback');
	});

	it('returns fallback when parsed result is falsy (empty string)', () => {
		expect(getJSON('""', 'fallback')).toBe('fallback');
	});

	it('returns fallback when parsed result is falsy (zero)', () => {
		expect(getJSON('0', 99)).toBe(99);
	});

	it('returns fallback when parsed result is falsy (null)', () => {
		expect(getJSON('null', 'fallback')).toBe('fallback');
	});

	it('returns valid truthy parsed result (non-empty string)', () => {
		expect(getJSON('"hello"', 'fallback')).toBe('hello');
	});

	it('returns fallback for boolean input', () => {
		expect(getJSON(true, 'fallback')).toBe('fallback');
	});

	it('returns fallback for object input', () => {
		expect(getJSON({ key: 'value' }, 'fallback')).toBe('fallback');
	});
});
