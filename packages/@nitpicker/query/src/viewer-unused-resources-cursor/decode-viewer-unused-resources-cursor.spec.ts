import { describe, expect, it } from 'vitest';

import { VIEWER_READ_MODEL_SCHEMA_VERSION } from '../viewer-read-model/viewer-read-model-schema-version.js';

import { decodeViewerUnusedResourcesCursor } from './decode-viewer-unused-resources-cursor.js';
import { encodeViewerUnusedResourcesCursor } from './encode-viewer-unused-resources-cursor.js';

const EXPECTED = {
	filterKey: '{"source":null}',
	sortBy: 'url' as const,
	sortOrder: 'asc' as const,
	expectedValueCount: 2,
};

describe('decodeViewerUnusedResourcesCursor', () => {
	it('decodes a cursor that matches the expected filter/sort', () => {
		const cursor = encodeViewerUnusedResourcesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			values: ['https://example.com/orphan.pdf', 1],
		});
		expect(decodeViewerUnusedResourcesCursor(cursor, EXPECTED)).toEqual({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			values: ['https://example.com/orphan.pdf', 1],
		});
	});

	it('throws on an undecodable string', () => {
		expect(() => decodeViewerUnusedResourcesCursor('%%%not-base64%%%', EXPECTED)).toThrow(
			/not decodable/,
		);
	});

	it('throws on a decodable but malformed payload', () => {
		const cursor = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8').toString(
			'base64url',
		);
		expect(() => decodeViewerUnusedResourcesCursor(cursor, EXPECTED)).toThrow(
			/malformed/,
		);
	});

	it('throws on a cursor minted under a stale schema version', () => {
		const cursor = encodeViewerUnusedResourcesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION - 1,
			...EXPECTED,
			values: ['https://example.com/orphan.pdf', 1],
		});
		expect(() => decodeViewerUnusedResourcesCursor(cursor, EXPECTED)).toThrow(/[Ss]tale/);
	});

	it('throws on a cursor minted under a different filter', () => {
		const cursor = encodeViewerUnusedResourcesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			filterKey: '{"source":"inventory-seed"}',
			values: ['https://example.com/orphan.pdf', 1],
		});
		expect(() => decodeViewerUnusedResourcesCursor(cursor, EXPECTED)).toThrow(
			/does not match/,
		);
	});

	it('throws on a cursor minted under a different sort', () => {
		const cursor = encodeViewerUnusedResourcesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			sortBy: 'source',
			values: ['crawled', 'https://example.com/orphan.pdf', 1],
		});
		expect(() => decodeViewerUnusedResourcesCursor(cursor, EXPECTED)).toThrow(
			/does not match/,
		);
	});

	it('throws on a values array whose length does not match expectedValueCount', () => {
		const cursor = encodeViewerUnusedResourcesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			values: ['https://example.com/orphan.pdf'],
		});
		expect(() => decodeViewerUnusedResourcesCursor(cursor, EXPECTED)).toThrow(
			/keyset value count/,
		);
	});
});
