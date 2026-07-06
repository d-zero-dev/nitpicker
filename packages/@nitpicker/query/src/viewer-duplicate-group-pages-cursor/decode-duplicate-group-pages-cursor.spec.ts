import { describe, expect, it } from 'vitest';

import { VIEWER_READ_MODEL_SCHEMA_VERSION } from '../viewer-read-model/viewer-read-model-schema-version.js';

import { decodeDuplicateGroupPagesCursor } from './decode-duplicate-group-pages-cursor.js';
import { encodeDuplicateGroupPagesCursor } from './encode-duplicate-group-pages-cursor.js';

const PAYLOAD_BASE = {
	filterKey: '{"groupId":1}',
	sortBy: 'url' as const,
	sortOrder: 'asc' as const,
};

const EXPECTED = { filterKey: PAYLOAD_BASE.filterKey };

describe('decodeDuplicateGroupPagesCursor', () => {
	it('decodes a cursor that matches the expected filter', () => {
		const cursor = encodeDuplicateGroupPagesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			values: ['https://example.com/a', 7],
		});
		expect(decodeDuplicateGroupPagesCursor(cursor, EXPECTED)).toEqual({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			values: ['https://example.com/a', 7],
		});
	});

	it('throws on an undecodable string', () => {
		expect(() => decodeDuplicateGroupPagesCursor('%%%not-base64%%%', EXPECTED)).toThrow(
			/not decodable/,
		);
	});

	it('throws on a cursor minted under a stale schema version', () => {
		const cursor = encodeDuplicateGroupPagesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION - 1,
			...PAYLOAD_BASE,
			values: ['https://example.com/a', 7],
		});
		expect(() => decodeDuplicateGroupPagesCursor(cursor, EXPECTED)).toThrow(/[Ss]tale/);
	});

	it('throws on a cursor minted under a different groupId', () => {
		const cursor = encodeDuplicateGroupPagesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			filterKey: '{"groupId":2}',
			values: ['https://example.com/a', 7],
		});
		expect(() => decodeDuplicateGroupPagesCursor(cursor, EXPECTED)).toThrow(
			/does not match/,
		);
	});

	it('throws on a values array whose length does not match the expected column count', () => {
		const cursor = encodeDuplicateGroupPagesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			values: ['https://example.com/a'],
		});
		expect(() => decodeDuplicateGroupPagesCursor(cursor, EXPECTED)).toThrow(
			/keyset value count/,
		);
	});
});
