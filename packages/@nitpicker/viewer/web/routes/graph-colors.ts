/**
 * Sigma node fills for the Network Graph view, shared by
 * {@link import('./pick-node-color.js').pickNodeColor} (which maps
 * a `(status, PageSource)` pair to a color) and
 * {@link import('./graph-legend.js').GraphLegend} (which renders
 * the same colors as a legend so an operator can decode the graph
 * without reading source).
 *
 * The single source of truth lives here so a hue change flows to both
 * consumers automatically — otherwise the legend and the rendered
 * nodes will drift the first time someone tweaks one and forgets
 * the other.
 */
export const GRAPH_COLORS = {
	/** Node fill for `crawled` pages with a healthy status. */
	crawled: '#4aa3ff',
	/** Node fill when the page returned a 4xx/5xx status (overrides source). */
	error: '#ff6b6b',
	/** Node fill for `inventory-seed` pages — URLs from the operator's inventory list. */
	inventorySeed: '#ff9f43',
	/** Node fill for `inventory-discovered` pages — reached by following anchors from an inventory-seed. */
	inventoryDiscovered: '#a06cd5',
} as const;
