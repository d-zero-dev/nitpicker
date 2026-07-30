import { describe, expect, it } from 'vitest';

import { VIEWER_READ_MODEL_SCHEMA_VERSION } from '../viewer-read-model/viewer-read-model-schema-version.js';

import { decodeInboundLinksCursor } from './decode-inbound-links-cursor.js';
import { encodeInboundLinksCursor } from './encode-inbound-links-cursor.js';

const PAYLOAD_BASE = {
	filterKey: '{"destPageId":1}',
	sortBy: 'edgeId' as const,
	sortOrder: 'asc' as const,
};

const EXPECTED = { filterKey: PAYLOAD_BASE.filterKey };

describe('decodeInboundLinksCursor', () => {
	it('decodes a cursor that matches the expected filter', () => {
		const cursor = encodeInboundLinksCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			values: [7],
		});
		expect(decodeInboundLinksCursor(cursor, EXPECTED)).toEqual({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			values: [7],
		});
	});

	it('throws on an undecodable string', () => {
		expect(() => decodeInboundLinksCursor('%%%not-base64%%%', EXPECTED)).toThrow(
			/not decodable/,
		);
	});

	it('throws on a cursor minted under a stale schema version', () => {
		const cursor = encodeInboundLinksCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION - 1,
			...PAYLOAD_BASE,
			values: [7],
		});
		expect(() => decodeInboundLinksCursor(cursor, EXPECTED)).toThrow(/[Ss]tale/);
	});

	it('throws on a cursor minted for a different destPageId', () => {
		const cursor = encodeInboundLinksCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			filterKey: '{"destPageId":2}',
			values: [7],
		});
		expect(() => decodeInboundLinksCursor(cursor, EXPECTED)).toThrow(/does not match/);
	});

	it('throws on a values array whose length does not match the expected column count', () => {
		const cursor = encodeInboundLinksCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...PAYLOAD_BASE,
			values: [7, 8],
		});
		expect(() => decodeInboundLinksCursor(cursor, EXPECTED)).toThrow(
			/keyset value count/,
		);
	});
});
