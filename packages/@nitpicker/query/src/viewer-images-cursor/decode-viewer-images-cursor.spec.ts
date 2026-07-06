import { describe, expect, it } from 'vitest';

import { VIEWER_READ_MODEL_SCHEMA_VERSION } from '../viewer-read-model/viewer-read-model-schema-version.js';

import { decodeViewerImagesCursor } from './decode-viewer-images-cursor.js';
import { encodeViewerImagesCursor } from './encode-viewer-images-cursor.js';

const EXPECTED = {
	filterKey: '{"missingAlt":false,"missingDimensions":null,"oversizedThreshold":null}',
	sortBy: 'pageUrl' as const,
	sortOrder: 'asc' as const,
	expectedValueCount: 2,
};

describe('decodeViewerImagesCursor', () => {
	it('decodes a cursor that matches the expected filter/sort', () => {
		const cursor = encodeViewerImagesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			values: [3, 1],
		});
		expect(decodeViewerImagesCursor(cursor, EXPECTED)).toEqual({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			values: [3, 1],
		});
	});

	it('throws on an undecodable string', () => {
		expect(() => decodeViewerImagesCursor('%%%not-base64%%%', EXPECTED)).toThrow(
			/not decodable/,
		);
	});

	it('throws on a decodable but malformed payload', () => {
		const cursor = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8').toString(
			'base64url',
		);
		expect(() => decodeViewerImagesCursor(cursor, EXPECTED)).toThrow(/malformed/);
	});

	it('throws on a cursor minted under a stale schema version', () => {
		const cursor = encodeViewerImagesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION - 1,
			...EXPECTED,
			values: [3, 1],
		});
		expect(() => decodeViewerImagesCursor(cursor, EXPECTED)).toThrow(/[Ss]tale/);
	});

	it('throws on a cursor minted under a different filter', () => {
		const cursor = encodeViewerImagesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			filterKey: '{"missingAlt":true,"missingDimensions":null,"oversizedThreshold":null}',
			values: [3, 1],
		});
		expect(() => decodeViewerImagesCursor(cursor, EXPECTED)).toThrow(/does not match/);
	});

	it('throws on a cursor minted under a different sort', () => {
		const cursor = encodeViewerImagesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			sortBy: 'width',
			values: [100, 1],
		});
		expect(() => decodeViewerImagesCursor(cursor, EXPECTED)).toThrow(/does not match/);
	});

	it('throws on a values array whose length does not match expectedValueCount', () => {
		const cursor = encodeViewerImagesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			...EXPECTED,
			values: [3],
		});
		expect(() => decodeViewerImagesCursor(cursor, EXPECTED)).toThrow(
			/keyset value count/,
		);
	});
});
