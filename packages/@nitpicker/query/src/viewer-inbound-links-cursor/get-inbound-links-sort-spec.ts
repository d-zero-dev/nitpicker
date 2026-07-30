import type { InboundLinksSortSpec } from './types.js';

/**
 * Resolves the keyset sort plan for `viewer_anchor_facts` when read by
 * `dest_page_id`. There is only one supported order (`edge_id` ascending) —
 * see {@link InboundLinksSortSpec}'s docs for why no `sortBy`/`sortOrder`
 * parameter is needed.
 * @returns The fixed {@link InboundLinksSortSpec}.
 */
export function getInboundLinksSortSpec(): InboundLinksSortSpec {
	return { columns: ['edge_id'], scanDirection: 'asc' };
}
