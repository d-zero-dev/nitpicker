import { describe, expect, it } from 'vitest';

import { getInboundLinksSortSpec } from './get-inbound-links-sort-spec.js';

describe('getInboundLinksSortSpec', () => {
	it('always sorts by edge_id ascending', () => {
		expect(getInboundLinksSortSpec()).toEqual({
			columns: ['edge_id'],
			scanDirection: 'asc',
		});
	});
});
