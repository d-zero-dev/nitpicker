import { describe, it, expect } from 'vitest';

import { parseResponseHeaders } from './parse-response-headers.js';

describe('parseResponseHeaders', () => {
	it('parses a JSON object into a header record', () => {
		expect(parseResponseHeaders('{"content-type":"image/png"}')).toEqual({
			'content-type': 'image/png',
		});
	});

	it('parses an empty JSON object as a valid empty record', () => {
		expect(parseResponseHeaders('{}')).toEqual({});
	});

	it('returns null for a null column value', () => {
		expect(parseResponseHeaders(null)).toBeNull();
	});

	it('returns null for the JSON string "null"', () => {
		expect(parseResponseHeaders('null')).toBeNull();
	});

	it('returns null for malformed JSON', () => {
		expect(parseResponseHeaders('{not json')).toBeNull();
	});

	it.each([
		['array', '["value"]'],
		['string', '"text"'],
		['number', '123'],
		['boolean', 'true'],
	])('returns null for valid JSON that is not a plain object (%s)', (_label, json) => {
		expect(parseResponseHeaders(json)).toBeNull();
	});
});
