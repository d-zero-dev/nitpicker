import { describe, expect, it } from 'vitest';

import { VIEWER_READ_MODEL_SCHEMA_VERSION } from '../viewer-read-model/viewer-read-model-schema-version.js';

import { encodeDirectoryPagesCursor } from './encode-directory-pages-cursor.js';

describe('encodeDirectoryPagesCursor', () => {
	it('encodes a payload as a base64url string, decodable back to the same JSON', () => {
		const payload = {
			v: VIEWER_READ_MODEL_SCHEMA_VERSION,
			nodeId: 42,
			pageUrlSortKey: 'https://example.com/a',
			pageId: 7,
		};
		const cursor = encodeDirectoryPagesCursor(payload);
		expect(cursor).not.toContain('+');
		expect(cursor).not.toContain('/');
		expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toEqual(
			payload,
		);
	});
});
