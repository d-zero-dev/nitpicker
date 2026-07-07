import { describe, expect, it } from 'vitest';

import { encodeDuplicateGroupPagesCursor } from './encode-duplicate-group-pages-cursor.js';

describe('encodeDuplicateGroupPagesCursor', () => {
	it('round-trips through base64url without loss', () => {
		const payload = {
			v: 13,
			filterKey: '{"groupId":1}',
			sortBy: 'url' as const,
			sortOrder: 'asc' as const,
			values: ['https://example.com/a', 7],
		};
		const cursor = encodeDuplicateGroupPagesCursor(payload);
		expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toEqual(
			payload,
		);
	});
});
