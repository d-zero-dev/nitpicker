import { describe, expect, it } from 'vitest';

import { VIEWER_READ_MODEL_SCHEMA_VERSION } from '../viewer-read-model/viewer-read-model-schema-version.js';

import { decodeAnchorFactsCursor } from './decode-anchor-facts-cursor.js';
import { encodeAnchorFactsCursor } from './encode-anchor-facts-cursor.js';

const PAYLOAD_BASE = {
	filterKey: '{"status":null}',
	sortBy: 'sourceUrl' as const,
	sortOrder: 'asc' as const,
};

const EXPECTED = {
	...PAYLOAD_BASE,
	columns: ['source_url_ref_id', 'edge_id'] as const,
};

describe('decodeAnchorFactsCursor', () => {
	it('decodes a cursor that matches the expected filter/sort', () => {
		const cursor = encodeAnchorFactsCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			values: [10, 1],
		});
		expect(decodeAnchorFactsCursor(cursor, EXPECTED)).toEqual({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			values: [10, 1],
		});
	});

	it('throws on an undecodable string', () => {
		expect(() => decodeAnchorFactsCursor('%%%not-base64%%%', EXPECTED)).toThrow(
			/not decodable/,
		);
	});

	it('throws on a decodable but malformed payload', () => {
		const cursor = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8').toString(
			'base64url',
		);
		expect(() => decodeAnchorFactsCursor(cursor, EXPECTED)).toThrow(/malformed/);
	});

	it('throws on a cursor minted under a stale schema version', () => {
		const cursor = encodeAnchorFactsCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION - 1,
			...PAYLOAD_BASE,
			values: [10, 1],
		});
		expect(() => decodeAnchorFactsCursor(cursor, EXPECTED)).toThrow(/[Ss]tale/);
	});

	it('throws on a cursor minted under a different filter', () => {
		const cursor = encodeAnchorFactsCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			filterKey: '{"status":404}',
			values: [10, 1],
		});
		expect(() => decodeAnchorFactsCursor(cursor, EXPECTED)).toThrow(/does not match/);
	});

	it('throws on a cursor minted under a different sort', () => {
		const cursor = encodeAnchorFactsCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			sortBy: 'status',
			values: [404, 10, 1],
		});
		expect(() => decodeAnchorFactsCursor(cursor, EXPECTED)).toThrow(/does not match/);
	});

	it('throws on a values array whose length does not match the expected column count', () => {
		const cursor = encodeAnchorFactsCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			values: [10],
		});
		expect(() => decodeAnchorFactsCursor(cursor, EXPECTED)).toThrow(/keyset value count/);
	});

	it('throws on a numeric-column position holding a string value', () => {
		const cursor = encodeAnchorFactsCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			values: ['not-a-number', 1],
		});
		expect(() => decodeAnchorFactsCursor(cursor, EXPECTED)).toThrow(/must be a number/);
	});
});
