import { describe, expect, it } from 'vitest';

import { encodeCursorEnvelope } from './encode-cursor-envelope.js';

describe('encodeCursorEnvelope', () => {
	it('encodes the payload as a URL-safe base64 string round-trippable via JSON.parse', () => {
		const payload = {
			v: 10,
			filterKey: '{"isExternal":false,"status":null}',
			sortBy: 'url' as const,
			sortOrder: 'asc' as const,
			values: ['https://example.com/a.css', 1],
		};
		const cursor = encodeCursorEnvelope(payload);
		expect(cursor).not.toMatch(/[+/=]/); // base64url has no +, /, or = padding
		expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toEqual(
			payload,
		);
	});
});
