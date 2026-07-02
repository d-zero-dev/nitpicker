import { describe, expect, it } from 'vitest';

import { VIEWER_READ_MODEL_SCHEMA_VERSION } from '../viewer-read-model/viewer-read-model-schema-version.js';

import { decodeViewerPagesCursor } from './decode-viewer-pages-cursor.js';
import { encodeViewerPagesCursor } from './encode-viewer-pages-cursor.js';

const EXPECTED = {
	filterKey: '{"isExternal":false}',
	sortBy: 'url' as const,
	sortOrder: 'asc' as const,
	expectedValueCount: 2,
};

describe('decodeViewerPagesCursor', () => {
	it('decodes a cursor that matches the expected filter/sort', () => {
		const cursor = encodeViewerPagesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			values: ['https://example.com/a', 1],
		});
		expect(decodeViewerPagesCursor(cursor, EXPECTED)).toEqual({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			values: ['https://example.com/a', 1],
		});
	});

	it('throws on an undecodable string', () => {
		expect(() => decodeViewerPagesCursor('%%%not-base64%%%', EXPECTED)).toThrow(
			/not decodable/,
		);
	});

	it('throws on a decodable but malformed payload', () => {
		const cursor = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8').toString(
			'base64url',
		);
		expect(() => decodeViewerPagesCursor(cursor, EXPECTED)).toThrow(/malformed/);
	});

	it('throws on a cursor minted under a stale schema version', () => {
		const cursor = encodeViewerPagesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION - 1,
			...EXPECTED,
			values: ['https://example.com/a', 1],
		});
		expect(() => decodeViewerPagesCursor(cursor, EXPECTED)).toThrow(/[Ss]tale/);
	});

	it('throws on a cursor minted under a different filter', () => {
		const cursor = encodeViewerPagesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			filterKey: '{"isExternal":true}',
			values: ['https://example.com/a', 1],
		});
		expect(() => decodeViewerPagesCursor(cursor, EXPECTED)).toThrow(/does not match/);
	});

	it('throws on a cursor minted under a different sort', () => {
		const cursor = encodeViewerPagesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			sortBy: 'title',
			values: ['A', 'https://example.com/a', 1],
		});
		expect(() => decodeViewerPagesCursor(cursor, EXPECTED)).toThrow(/does not match/);
	});

	it('throws on a values array whose length does not match expectedValueCount', () => {
		// filterKey/sortBy/sortOrder all match, but the tuple has one value
		// short — a hand-crafted/corrupted cursor that would otherwise reach
		// applyKeysetPredicate's positional column/value zip and build a
		// malformed SQL row-value comparison.
		const cursor = encodeViewerPagesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			values: ['https://example.com/a'],
		});
		expect(() => decodeViewerPagesCursor(cursor, EXPECTED)).toThrow(/keyset value count/);
	});
});
