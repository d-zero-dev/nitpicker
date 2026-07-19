import { describe, expect, it } from 'vitest';

import { encodeViewerPagesCursor } from './encode-viewer-pages-cursor.js';

describe('encodeViewerPagesCursor', () => {
	it('encodes the payload as a URL-safe base64 string round-trippable via JSON.parse', () => {
		const payload = {
			v: 2,
			filterKey: '{"isExternal":false}',
			sortBy: 'url' as const,
			sortOrder: 'asc' as const,
			values: ['https://example.com/a', 1],
		};
		const cursor = encodeViewerPagesCursor(payload);
		expect(cursor).not.toMatch(/[+/=]/); // base64url has no +, /, or = padding
		expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toEqual(
			payload,
		);
	});
});
