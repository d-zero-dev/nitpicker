import type { PageSource } from '@nitpicker/query';

/**
 * Visual badge for the `pages.source` / `resources.source` provenance label
 * returned by `listIsolatedPages` and `listUnusedResources`.
 *
 * Three values map to three visually distinct styles:
 *
 * - `crawled` — the row came from the recursive crawl; neutral styling so
 *   it does not draw the eye, since it is the common case.
 * - `inventory-seed` — the URL was explicitly handed in by
 *   `crawl --inventory`; accent styling so the audit operator can quickly
 *   tell "this row is on my server file list".
 * - `inventory-discovered` — the URL was found by following links from an
 *   inventory-seed page (or loaded by puppeteer as a sub-resource of one);
 *   muted accent so it groups visually with `inventory-seed` without
 *   dominating it.
 *
 * The badge's text is intentionally compact (`crawled` / `inv:seed` /
 * `inv:disc`) so a tight table column does not wrap. Full meaning lives in
 * the column header tooltip.
 * @param props
 * @param props.source - The {@link PageSource} value from the query result.
 */
export function SourceBadge({ source }: { source: PageSource }) {
	const label =
		source === 'inventory-seed'
			? 'inv:seed'
			: source === 'inventory-discovered'
				? 'inv:disc'
				: 'crawled';
	// Three distinct modifier classes so the audit operator can tell
	// inventory-seed (the URL came straight off the list) from
	// inventory-discovered (puppeteer-following from a seed) at a glance —
	// keeping them on the same hue but at different intensities preserves
	// the visual grouping ("both belong to the inventory pass") while
	// still being distinguishable.
	const className = `source-badge source-badge--${source}`;
	return (
		<span className={className} title={source}>
			{label}
		</span>
	);
}
