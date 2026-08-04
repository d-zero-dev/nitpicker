import { describe, expect, it } from 'vitest';

import { VIEWER_READ_MODEL_SCHEMA_VERSION } from '../viewer-read-model/viewer-read-model-schema-version.js';

import { decodeHeaderChecksCursor } from './decode-header-checks-cursor.js';
import { encodeHeaderChecksCursor } from './encode-header-checks-cursor.js';

const PAYLOAD_BASE = {
	filterKey: '{"missingOnly":null}',
	sortBy: 'urlBinary' as const,
	sortOrder: 'asc' as const,
};

const EXPECTED = {
	filterKey: PAYLOAD_BASE.filterKey,
	sortBy: PAYLOAD_BASE.sortBy,
	sortOrder: PAYLOAD_BASE.sortOrder,
};

describe('decodeHeaderChecksCursor', () => {
	it('decodes a cursor that matches the expected filter/sort', () => {
		const cursor = encodeHeaderChecksCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			values: ['https://example.com/a', 1],
		});
		expect(decodeHeaderChecksCursor(cursor, EXPECTED)).toEqual({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			values: ['https://example.com/a', 1],
		});
	});

	it('throws on an undecodable string', () => {
		expect(() => decodeHeaderChecksCursor('%%%not-base64%%%', EXPECTED)).toThrow(
			/not decodable/,
		);
	});

	it('throws on a cursor minted under a stale schema version', () => {
		const cursor = encodeHeaderChecksCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION - 1,
			...PAYLOAD_BASE,
			values: ['https://example.com/a', 1],
		});
		expect(() => decodeHeaderChecksCursor(cursor, EXPECTED)).toThrow(/[Ss]tale/);
	});

	it('throws on a cursor minted under a different filter', () => {
		const cursor = encodeHeaderChecksCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			filterKey: '{"missingOnly":true}',
			values: ['https://example.com/a', 1],
		});
		expect(() => decodeHeaderChecksCursor(cursor, EXPECTED)).toThrow(/does not match/);
	});

	it('throws on a cursor minted under a different sort order', () => {
		const cursor = encodeHeaderChecksCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			sortOrder: 'desc',
			values: ['https://example.com/a', 1],
		});
		expect(() => decodeHeaderChecksCursor(cursor, EXPECTED)).toThrow(/does not match/);
	});

	it('throws on a values array whose length does not match the expected column count', () => {
		const cursor = encodeHeaderChecksCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			values: ['https://example.com/a'],
		});
		expect(() => decodeHeaderChecksCursor(cursor, EXPECTED)).toThrow(
			/keyset value count/,
		);
	});

	it('throws on a cursor minted under a different effective sort (urlBinary vs urlNatural)', () => {
		const cursor = encodeHeaderChecksCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			sortBy: 'urlNatural',
			values: [3, 1],
		});
		expect(() => decodeHeaderChecksCursor(cursor, EXPECTED)).toThrow(/does not match/);
	});
});
