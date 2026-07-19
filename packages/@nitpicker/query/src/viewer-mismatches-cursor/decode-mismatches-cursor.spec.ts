import { describe, expect, it } from 'vitest';

import { VIEWER_READ_MODEL_SCHEMA_VERSION } from '../viewer-read-model/viewer-read-model-schema-version.js';

import { decodeMismatchesCursor } from './decode-mismatches-cursor.js';
import { encodeMismatchesCursor } from './encode-mismatches-cursor.js';

const PAYLOAD_BASE = {
	filterKey: '{"type":"canonical"}',
	sortBy: 'url' as const,
	sortOrder: 'asc' as const,
};

const EXPECTED = { filterKey: PAYLOAD_BASE.filterKey, sortOrder: PAYLOAD_BASE.sortOrder };

describe('decodeMismatchesCursor', () => {
	it('decodes a cursor that matches the expected filter/sort', () => {
		const cursor = encodeMismatchesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			values: ['https://example.com/a', 1],
		});
		expect(decodeMismatchesCursor(cursor, EXPECTED)).toEqual({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			values: ['https://example.com/a', 1],
		});
	});

	it('throws on an undecodable string', () => {
		expect(() => decodeMismatchesCursor('%%%not-base64%%%', EXPECTED)).toThrow(
			/not decodable/,
		);
	});

	it('throws on a cursor minted under a stale schema version', () => {
		const cursor = encodeMismatchesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION - 1,
			...PAYLOAD_BASE,
			values: ['https://example.com/a', 1],
		});
		expect(() => decodeMismatchesCursor(cursor, EXPECTED)).toThrow(/[Ss]tale/);
	});

	it('throws on a cursor minted under a different type', () => {
		const cursor = encodeMismatchesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			filterKey: '{"type":"og:title"}',
			values: ['https://example.com/a', 1],
		});
		expect(() => decodeMismatchesCursor(cursor, EXPECTED)).toThrow(/does not match/);
	});

	it('throws on a cursor minted under a different sort order', () => {
		const cursor = encodeMismatchesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			sortOrder: 'desc',
			values: ['https://example.com/a', 1],
		});
		expect(() => decodeMismatchesCursor(cursor, EXPECTED)).toThrow(/does not match/);
	});

	it('throws on a values array whose length does not match the expected column count', () => {
		const cursor = encodeMismatchesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			values: ['https://example.com/a'],
		});
		expect(() => decodeMismatchesCursor(cursor, EXPECTED)).toThrow(/keyset value count/);
	});
});
