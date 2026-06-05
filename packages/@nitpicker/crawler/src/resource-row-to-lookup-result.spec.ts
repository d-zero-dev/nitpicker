import type { DB_Resource } from './archive/types.js';

import { describe, it, expect } from 'vitest';

import { resourceRowToLookupResult } from './resource-row-to-lookup-result.js';

/**
 * Build a DB_Resource row with sensible defaults for tests.
 * @param overrides - Fields to override.
 * @returns A complete DB_Resource row.
 */
function createRow(overrides: Partial<DB_Resource> = {}): DB_Resource {
	return {
		id: 1,
		url: 'https://example.com/image.jpg',
		isExternal: 0,
		status: 200,
		statusText: 'OK',
		contentType: 'image/jpeg',
		contentLength: 1234,
		compress: 0,
		cdn: 0,
		responseHeaders: JSON.stringify({ 'content-type': 'image/jpeg' }),
		...overrides,
	};
}

describe('resourceRowToLookupResult', () => {
	it('converts a full row', () => {
		const result = resourceRowToLookupResult(createRow());
		expect(result).toEqual({
			status: 200,
			statusText: 'OK',
			contentType: 'image/jpeg',
			contentLength: 1234,
			responseHeaders: { 'content-type': 'image/jpeg' },
		});
	});

	it('parses null responseHeaders', () => {
		const result = resourceRowToLookupResult(createRow({ responseHeaders: null }));
		expect(result.responseHeaders).toBeNull();
	});

	it('parses the JSON string "null" as null', () => {
		const result = resourceRowToLookupResult(createRow({ responseHeaders: 'null' }));
		expect(result.responseHeaders).toBeNull();
	});

	it('falls back to null on malformed JSON', () => {
		const result = resourceRowToLookupResult(createRow({ responseHeaders: '{not json' }));
		expect(result.responseHeaders).toBeNull();
	});

	it.each([
		['array', '["value"]'],
		['string', '"text"'],
		['number', '123'],
		['boolean', 'true'],
	])('valid JSON that is not a plain object (%s) becomes null', (_label, json) => {
		const result = resourceRowToLookupResult(createRow({ responseHeaders: json }));
		expect(result.responseHeaders).toBeNull();
	});

	it('passes through null metadata fields', () => {
		const result = resourceRowToLookupResult(
			createRow({
				status: null,
				statusText: null,
				contentType: null,
				contentLength: null,
			}),
		);
		expect(result.status).toBeNull();
		expect(result.statusText).toBeNull();
		expect(result.contentType).toBeNull();
		expect(result.contentLength).toBeNull();
	});
});
