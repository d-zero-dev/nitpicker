/**
 * The page regions treated as chrome: HTML5 sectioning elements and their
 * ARIA landmark roles (`<header>` / `banner`, `<footer>` / `contentinfo`,
 * `<nav>` / `navigation`, `<aside>` / `complementary`, `role="form"`,
 * `<search>` / `search`). `main` is content and never one of them.
 */
export type LandmarkType = 'header' | 'footer' | 'nav' | 'aside' | 'form' | 'search';

/**
 * One landmark instance of a page as Stage B and cluster reasons read it:
 * its type and the token set of its markup tokenized on its own.
 */
export interface LandmarkInstanceTokens {
	readonly type: LandmarkType;
	readonly tokens: ReadonlySet<string>;
}

/**
 * Identity of a page's content-root element — the element whose subtree
 * holds the page-specific content and under which Stage A (in
 * `@nitpicker/core`) caps the nesting depth it compares.
 *
 * Every field that is given must match the same element. Empty strings and
 * empty arrays count as "not given", and a root with no constraint at all
 * matches nothing (otherwise the shallowest element of the page would win
 * and the cap would silently apply to the wrong node).
 *
 * A structured object rather than a CSS selector string: nothing has to be
 * parsed (the HTML parser already exposes `id`/`class`/`role`), it maps 1:1
 * onto the columns a crawler records for its detected main-content element,
 * and a crawler's own selector string is diagnostic (tag + id + classes) and
 * not guaranteed to be unique, so it is the wrong thing to re-parse.
 */
export type ContentRoot = {
	/** Case-insensitive: a crawler reading `Element.nodeName` reports `'DIV'`, the HTML parser reports `'div'`. */
	readonly tagName?: string;
	readonly id?: string;
	readonly role?: string;
	/** Every listed class must be present on the element (subset match; order does not matter). */
	readonly classList?: readonly string[];
};

/**
 * Result of {@link ./compute-document-frequency.js | computeDocumentFrequency}: how many pages (out of `pageCount`) contain each token.
 *
 * `pageCount` travels bundled with `documentFrequency` rather than being a
 * separate argument at call sites that consume it (e.g.
 * `splitTokensByFrequency`), so the two can never be passed out of sync with
 * each other (e.g. a caller re-slicing the page list after computing
 * frequencies but before using them).
 */
export type DocumentFrequency = {
	documentFrequency: ReadonlyMap<string, number>;
	pageCount: number;
};
