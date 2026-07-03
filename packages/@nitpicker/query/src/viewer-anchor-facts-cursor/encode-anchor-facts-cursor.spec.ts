import { describe, expect, it } from 'vitest';

import { encodeAnchorFactsCursor } from './encode-anchor-facts-cursor.js';

describe('encodeAnchorFactsCursor', () => {
	it('round-trips through base64url without loss', () => {
		const payload = {
			v: 6,
			filterKey: '{"status":null}',
			sortBy: 'sourceUrl' as const,
			sortOrder: 'asc' as const,
			values: ['https://example.com/a', 1],
		};
		const cursor = encodeAnchorFactsCursor(payload);
		expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toEqual(
			payload,
		);
	});
});
