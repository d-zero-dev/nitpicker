import { describe, expect, it } from 'vitest';

import { buildInboundLinksFilterKey } from './build-inbound-links-filter-key.js';

describe('buildInboundLinksFilterKey', () => {
	it('produces the canonical {"destPageId":N} JSON shape', () => {
		expect(buildInboundLinksFilterKey({ destPageId: 1 })).toBe('{"destPageId":1}');
	});

	it('produces different keys for different destPageIds', () => {
		expect(buildInboundLinksFilterKey({ destPageId: 1 })).not.toBe(
			buildInboundLinksFilterKey({ destPageId: 2 }),
		);
	});

	it('produces the same key for the same destPageId across calls', () => {
		expect(buildInboundLinksFilterKey({ destPageId: 1 })).toBe(
			buildInboundLinksFilterKey({ destPageId: 1 }),
		);
	});
});
