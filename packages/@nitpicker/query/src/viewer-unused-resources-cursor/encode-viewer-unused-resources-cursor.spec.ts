import { describe, expect, it } from 'vitest';

import { encodeViewerUnusedResourcesCursor } from './encode-viewer-unused-resources-cursor.js';

describe('encodeViewerUnusedResourcesCursor', () => {
	it('encodes the payload as a URL-safe base64 string round-trippable via JSON.parse', () => {
		const payload = {
			v: 10,
			filterKey: '{"status":null,"source":null}',
			sortBy: 'url' as const,
			sortOrder: 'asc' as const,
			values: ['https://example.com/orphan.pdf', 1],
		};
		const cursor = encodeViewerUnusedResourcesCursor(payload);
		expect(cursor).not.toMatch(/[+/=]/); // base64url has no +, /, or = padding
		expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toEqual(
			payload,
		);
	});
});
