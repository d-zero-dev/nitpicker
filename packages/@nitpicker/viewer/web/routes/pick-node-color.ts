import type { PageSource } from '@nitpicker/query';

import { GRAPH_COLORS } from './graph-colors.js';

/**
 * Picks the sigma node fill for a graph node.
 *
 * Error status wins over source (a broken page needs to draw the eye regardless
 * of where it came from). Otherwise the three ingestion channels are visually
 * distinct so an operator can tell inventory pages from the crawled backbone.
 *
 * The `source: PageSource` typing forces this switch to stay exhaustive:
 * adding a fourth provenance channel to the union in `@nitpicker/crawler`
 * will surface as a type error (via the `satisfies never` guard) instead of
 * silently falling through to `GRAPH_COLORS.crawled`. The same union drives
 * `SourceBadge` (Isolated Pages / Unused Resources tables) — a hue change
 * in one place needs a matching change here so the two views stay legible
 * when cross-referenced.
 * @param status - HTTP status of the page (null if unknown).
 * @param source - Ingestion provenance of the page.
 * @returns A hex color string.
 */
export function pickNodeColor(status: number | null, source: PageSource): string {
	if (status != null && status >= 400) {
		return GRAPH_COLORS.error;
	}
	switch (source) {
		case 'inventory-seed': {
			return GRAPH_COLORS.inventorySeed;
		}
		case 'inventory-discovered': {
			return GRAPH_COLORS.inventoryDiscovered;
		}
		case 'crawled': {
			return GRAPH_COLORS.crawled;
		}
		default: {
			const _exhaustive: never = source;
			return _exhaustive;
		}
	}
}
