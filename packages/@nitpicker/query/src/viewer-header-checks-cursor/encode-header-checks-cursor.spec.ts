import { describe, expect, it } from 'vitest';

import { encodeHeaderChecksCursor } from './encode-header-checks-cursor.js';

describe('encodeHeaderChecksCursor', () => {
	it('round-trips through base64url without loss', () => {
		const payload = {
			v: 12,
			filterKey: '{"missingOnly":null}',
			sortBy: 'url' as const,
			sortOrder: 'asc' as const,
			values: ['https://example.com/a', 1],
		};
		const cursor = encodeHeaderChecksCursor(payload);
		expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toEqual(
			payload,
		);
	});
});
