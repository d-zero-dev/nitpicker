import { describe, expect, it } from 'vitest';

import { encodeMismatchesCursor } from './encode-mismatches-cursor.js';

describe('encodeMismatchesCursor', () => {
	it('round-trips through base64url without loss', () => {
		const payload = {
			v: 13,
			filterKey: '{"type":"canonical"}',
			sortBy: 'url' as const,
			sortOrder: 'asc' as const,
			values: ['https://example.com/a', 1],
		};
		const cursor = encodeMismatchesCursor(payload);
		expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toEqual(
			payload,
		);
	});
});
