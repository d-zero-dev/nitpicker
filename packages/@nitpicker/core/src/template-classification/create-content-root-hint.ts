import type { PageClusterSignals } from '@d-zero/page-cluster/resolve-page-cluster-keys';
import type { Page } from '@nitpicker/crawler';

/**
 * Builds the `contentRoot` hint `@d-zero/page-cluster` anchors its
 * content-depth cap on, from the main-content element the crawler recorded
 * for a page (`page_meta.main_content_*`, detected at crawl time by
 * `@d-zero/beholder` or forced with `--main-content-selector`).
 *
 * Sites without `<main>` / `role="main"` — the case the hint exists for —
 * otherwise leave the library with no anchor for its cap, so freeform body
 * content dominates the comparison and one template fragments into many
 * clusters. The crawler already knows which element holds the page-specific
 * content; this hands that element's identity over instead of having the
 * library guess it.
 *
 * Fields the crawler left empty are dropped: `nodeName` is lower-cased (the
 * DOM reports `'DIV'`, the library compares against the parser's `'div'`), and
 * an empty id / role / class list is omitted, since the library treats
 * "given but empty" and "absent" the same and a hint with nothing left
 * matches nothing. Returns `undefined` when the page has no detected main
 * content (never rendered, or no candidate element) or nothing usable is
 * left, so the factory can leave the field off the page's signals entirely.
 *
 * Deliberately not built from `mainContentSelector`: it is a diagnostic
 * `tag#id.class` string that is not guaranteed unique and would need a CSS
 * selector parser on the library side; the four structured columns carry the
 * same information without parsing.
 * @param page - Anything exposing the four main-content getters of `Page`.
 * @returns The hint, or `undefined` when there is nothing to anchor on.
 * @example
 * ```ts
 * createContentRootHint(page);
 * // { tagName: 'div', id: 'main', classList: ['spc'] }
 * ```
 */
export function createContentRootHint(
	page: Pick<
		Page,
		'mainContentNodeName' | 'mainContentId' | 'mainContentRole' | 'mainContentClassList'
	>,
): PageClusterSignals['contentRoot'] {
	const tagName = page.mainContentNodeName?.toLowerCase();
	const id = page.mainContentId;
	const role = page.mainContentRole;
	// The getter parses JSON on every read, so read it once.
	const classList = page.mainContentClassList;

	const hint = {
		...(tagName ? { tagName } : {}),
		...(id ? { id } : {}),
		...(role ? { role } : {}),
		...(classList && classList.length > 0 ? { classList } : {}),
	};
	return Object.keys(hint).length > 0 ? hint : undefined;
}
