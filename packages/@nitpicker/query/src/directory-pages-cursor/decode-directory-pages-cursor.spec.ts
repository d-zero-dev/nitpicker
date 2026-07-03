import { describe, expect, it } from 'vitest';

import { VIEWER_READ_MODEL_SCHEMA_VERSION } from '../viewer-read-model/viewer-read-model-schema-version.js';

import { decodeDirectoryPagesCursor } from './decode-directory-pages-cursor.js';
import { encodeDirectoryPagesCursor } from './encode-directory-pages-cursor.js';

const NODE_ID = 42;

describe('decodeDirectoryPagesCursor', () => {
	it('decodes a cursor minted for the expected nodeId', () => {
		const cursor = encodeDirectoryPagesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			nodeId: NODE_ID,
			pageUrlSortKey: 'https://example.com/a',
			pageId: 7,
		});
		expect(decodeDirectoryPagesCursor(cursor, NODE_ID)).toEqual({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			nodeId: NODE_ID,
			pageUrlSortKey: 'https://example.com/a',
			pageId: 7,
		});
	});

	it('throws on an undecodable string', () => {
		expect(() => decodeDirectoryPagesCursor('%%%not-base64%%%', NODE_ID)).toThrow(
			/not decodable/,
		);
	});

	it('throws on a decodable but malformed payload', () => {
		const cursor = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8').toString(
			'base64url',
		);
		expect(() => decodeDirectoryPagesCursor(cursor, NODE_ID)).toThrow(/malformed/);
	});

	it('throws on a cursor minted under a stale schema version', () => {
		const cursor = encodeDirectoryPagesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION - 1,
			nodeId: NODE_ID,
			pageUrlSortKey: 'https://example.com/a',
			pageId: 7,
		});
		expect(() => decodeDirectoryPagesCursor(cursor, NODE_ID)).toThrow(/[Ss]tale/);
	});

	it('throws on a cursor minted for a different nodeId', () => {
		const cursor = encodeDirectoryPagesCursor({
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			nodeId: NODE_ID + 1,
			pageUrlSortKey: 'https://example.com/a',
			pageId: 7,
		});
		expect(() => decodeDirectoryPagesCursor(cursor, NODE_ID)).toThrow(/does not match/);
	});
});
