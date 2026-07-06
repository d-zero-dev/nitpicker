import { describe, expect, it } from 'vitest';

import { VIEWER_READ_MODEL_SCHEMA_VERSION } from '../viewer-read-model/viewer-read-model-schema-version.js';

import { decodeDuplicateGroupsCursor } from './decode-duplicate-groups-cursor.js';
import { encodeDuplicateGroupsCursor } from './encode-duplicate-groups-cursor.js';

const PAYLOAD_BASE = {
	filterKey: '{"field":"title"}',
	sortBy: 'count' as const,
	sortOrder: 'asc' as const,
};

const EXPECTED = { filterKey: PAYLOAD_BASE.filterKey };

describe('decodeDuplicateGroupsCursor', () => {
	it('decodes a cursor that matches the expected filter', () => {
		const cursor = encodeDuplicateGroupsCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			values: [-5, 3],
		});
		expect(decodeDuplicateGroupsCursor(cursor, EXPECTED)).toEqual({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			values: [-5, 3],
		});
	});

	it('throws on an undecodable string', () => {
		expect(() => decodeDuplicateGroupsCursor('%%%not-base64%%%', EXPECTED)).toThrow(
			/not decodable/,
		);
	});

	it('throws on a cursor minted under a stale schema version', () => {
		const cursor = encodeDuplicateGroupsCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION - 1,
			...PAYLOAD_BASE,
			values: [-5, 3],
		});
		expect(() => decodeDuplicateGroupsCursor(cursor, EXPECTED)).toThrow(/[Ss]tale/);
	});

	it('throws on a cursor minted under a different field', () => {
		const cursor = encodeDuplicateGroupsCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			filterKey: '{"field":"description"}',
			values: [-5, 3],
		});
		expect(() => decodeDuplicateGroupsCursor(cursor, EXPECTED)).toThrow(/does not match/);
	});

	it('throws on a values array whose length does not match the expected column count', () => {
		const cursor = encodeDuplicateGroupsCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			values: [-5],
		});
		expect(() => decodeDuplicateGroupsCursor(cursor, EXPECTED)).toThrow(
			/keyset value count/,
		);
	});
});
