import { describe, expect, it } from 'vitest';

import { encodeInboundLinksCursor } from './encode-inbound-links-cursor.js';

describe('encodeInboundLinksCursor', () => {
	it('round-trips through base64url without loss', () => {
		const payload = {
			v: 22,
			filterKey: '{"destPageId":1}',
			sortBy: 'edgeId' as const,
			sortOrder: 'asc' as const,
			values: [7],
		};
		const cursor = encodeInboundLinksCursor(payload);
		expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toEqual(
			payload,
		);
	});
});
