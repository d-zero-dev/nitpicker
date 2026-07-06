import { describe, expect, it } from 'vitest';

import { encodeViewerImagesCursor } from './encode-viewer-images-cursor.js';

describe('encodeViewerImagesCursor', () => {
	it('encodes the payload as a URL-safe base64 string round-trippable via JSON.parse', () => {
		const payload = {
			v: 11,
			filterKey:
				'{"missingAlt":false,"missingDimensions":null,"oversizedThreshold":null}',
			sortBy: 'pageUrl' as const,
			sortOrder: 'asc' as const,
			values: [3, 1],
		};
		const cursor = encodeViewerImagesCursor(payload);
		expect(cursor).not.toMatch(/[+/=]/); // base64url has no +, /, or = padding
		expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toEqual(
			payload,
		);
	});
});
