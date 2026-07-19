import { describe, expect, it } from 'vitest';

import { VIEWER_READ_MODEL_SCHEMA_VERSION } from '../viewer-read-model/viewer-read-model-schema-version.js';

import { decodeViewerResourcesCursor } from './decode-viewer-resources-cursor.js';
import { encodeViewerResourcesCursor } from './encode-viewer-resources-cursor.js';

const EXPECTED = {
	filterKey: '{"isExternal":false}',
	sortBy: 'url' as const,
	sortOrder: 'asc' as const,
	expectedValueCount: 2,
};

describe('decodeViewerResourcesCursor', () => {
	it('decodes a cursor that matches the expected filter/sort', () => {
		const cursor = encodeViewerResourcesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			values: ['https://example.com/a.css', 1],
		});
		expect(decodeViewerResourcesCursor(cursor, EXPECTED)).toEqual({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			values: ['https://example.com/a.css', 1],
		});
	});

	it('throws on an undecodable string', () => {
		expect(() => decodeViewerResourcesCursor('%%%not-base64%%%', EXPECTED)).toThrow(
			/not decodable/,
		);
	});

	it('throws on a decodable but malformed payload', () => {
		const cursor = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8').toString(
			'base64url',
		);
		expect(() => decodeViewerResourcesCursor(cursor, EXPECTED)).toThrow(/malformed/);
	});

	it('throws on a cursor minted under a stale schema version', () => {
		const cursor = encodeViewerResourcesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION - 1,
			...EXPECTED,
			values: ['https://example.com/a.css', 1],
		});
		expect(() => decodeViewerResourcesCursor(cursor, EXPECTED)).toThrow(/[Ss]tale/);
	});

	it('throws on a cursor minted under a different filter', () => {
		const cursor = encodeViewerResourcesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			filterKey: '{"isExternal":true}',
			values: ['https://example.com/a.css', 1],
		});
		expect(() => decodeViewerResourcesCursor(cursor, EXPECTED)).toThrow(/does not match/);
	});

	it('throws on a cursor minted under a different sort', () => {
		const cursor = encodeViewerResourcesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			sortBy: 'status',
			values: [200, 'https://example.com/a.css', 1],
		});
		expect(() => decodeViewerResourcesCursor(cursor, EXPECTED)).toThrow(/does not match/);
	});

	it('throws on a values array whose length does not match expectedValueCount', () => {
		const cursor = encodeViewerResourcesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			values: ['https://example.com/a.css'],
		});
		expect(() => decodeViewerResourcesCursor(cursor, EXPECTED)).toThrow(
			/keyset value count/,
		);
	});
});
