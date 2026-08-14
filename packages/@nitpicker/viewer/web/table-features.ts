import {
	columnResizingFeature,
	columnSizingFeature,
	columnVisibilityFeature,
	tableFeatures,
} from '@tanstack/react-table';

/**
 * The TanStack Table v9 feature set used by
 * {@link import('./components/paged-table.js').PagedTable} and
 * {@link import('./components/virtual-table.js').VirtualTable}.
 *
 * Sorting, filtering, and pagination are handled server-side (URL-driven —
 * see {@link import('./components/paged-table.js').TableSortControl}/
 * {@link import('./components/paged-table.js').TableFilterControl}), so only column
 * sizing (committed widths), column resizing (the drag/keyboard
 * interaction), and column visibility (`row.getVisibleCells()`, used for
 * every rendered row regardless of whether any column is ever hidden) are
 * registered. Registering the full `stockFeatures` kitchen sink instead
 * would let `table.state` type-check calls into TanStack's own
 * sorting/filtering APIs, which would silently desync from the URL-owned
 * state this viewer actually uses.
 */
export const viewerTableFeatures = tableFeatures({
	columnSizingFeature,
	columnResizingFeature,
	columnVisibilityFeature,
});
