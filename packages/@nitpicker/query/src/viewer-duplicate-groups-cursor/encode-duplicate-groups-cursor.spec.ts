import { describe, expect, it } from 'vitest';

import { encodeDuplicateGroupsCursor } from './encode-duplicate-groups-cursor.js';

describe('encodeDuplicateGroupsCursor', () => {
	it('round-trips through base64url without loss', () => {
		const payload = {
			v: 13,
			filterKey: '{"field":"title"}',
			sortBy: 'count' as const,
			sortOrder: 'asc' as const,
			values: [-5, 3],
		};
		const cursor = encodeDuplicateGroupsCursor(payload);
		expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toEqual(
			payload,
		);
	});
});
