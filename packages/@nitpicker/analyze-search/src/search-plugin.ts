import type { TableData } from '@nitpicker/core';

import { strToRegex } from '@d-zero/shared/str-to-regex';
import { definePlugin } from '@nitpicker/core';

/**
 * A search item with a custom display title.
 * Allows decoupling the search pattern from its column header label
 * so that report columns can have human-friendly names.
 */
type Content = {
	/** The search pattern string (keyword or CSS selector). */
	search: string;
	/** Column header label displayed in the report. */
	title: string;
};

/**
 * Plugin options for the keyword/selector search analysis.
 */
type Options = {
	/**
	 * CSS selector to narrow the search scope within each page.
	 * When omitted, the entire `documentElement` is searched.
	 * Useful for restricting searches to main content areas and
	 * ignoring headers, footers, and navigation.
	 */
	scope?: string;
	/**
	 * Keywords to search for in DOM text nodes and element attributes.
	 * Each item can be a plain string or a `Content` object with a
	 * custom display title. Strings are converted to regex via
	 * `strToRegex` (supporting literal and `/pattern/flags` syntax).
	 */
	keywords?: (string | Content)[];
	/**
	 * CSS selectors to check for existence on each page.
	 * The result is boolean (present or absent), not a count.
	 */
	selectors?: (string | Content)[];
};

/**
 * Analyze plugin that searches page DOMs for keywords and CSS selectors.
 *
 * Keywords are matched using `recursiveSearch()`, which traverses the
 * DOM tree depth-first and checks both text nodes and element attributes.
 * Selectors are checked with `querySelector()` for simple existence.
 * @example
 * ```jsonc
 * // nitpicker.config.json
 * {
 *   "plugins": {
 *     "analyze": {
 *       "@nitpicker/analyze-search": {
 *         "scope": "main",
 *         "keywords": ["lorem ipsum", "/\\d{3}-\\d{4}/"],
 *         "selectors": [".breadcrumb", "nav.global"]
 *       }
 *     }
 *   }
 * }
 * ```
 */
export default definePlugin((options: Options) => {
	const headers = {
		...toHeader('keyword', options.keywords),
		...toHeader('selector', options.selectors),
	};
	const keywords = toArray(options.keywords);
	const selectors = toArray(options.selectors);

	return {
		label: 'キーワード検索',
		headers,
		eachPage({ window }) {
			const result: TableData<string> = {};

			const $scope = options.scope
				? window.document.querySelector(options.scope)
				: window.document.documentElement;

			if (!$scope) {
				return null;
			}

			for (const keyword of keywords) {
				const regex = strToRegex(keyword);

				const searched = recursiveSearch($scope, regex);

				result[`keyword:${keyword}`] = { value: searched.length };
			}

			for (const selector of selectors) {
				try {
					const $main = window.document.querySelector(selector);
					if ($main) {
						result[`selector:${selector}`] = { value: true };
					}
				} catch {
					// Error
				}
			}

			return {
				page: result,
			};
		},
	};
});

/**
 * Extracts unique search terms from a mixed array of strings and Content objects.
 * Deduplication ensures the same keyword/selector is not searched twice even
 * when specified in both plain-string and Content-object forms.
 * @param search - Array of keyword/selector items.
 * @returns Deduplicated array of search term strings.
 */
function toArray(search?: (string | Content)[]) {
	if (!search) {
		return [];
	}
	const set = new Set<string>();
	for (const item of search) {
		if (typeof item === 'string') {
			set.add(item);
			continue;
		}
		set.add(item.title);
	}
	return [...set];
}

/**
 * Builds a header map from search items, keyed by `"{type}:{term}"`.
 *
 * The compound key format ensures keyword and selector columns are
 * namespaced and do not collide (e.g. `"keyword:foo"` vs `"selector:foo"`).
 * Content objects use their custom `title` as the column header label;
 * plain strings get a generated label like `"Search keyword: foo"`.
 * @param type - Whether these are keyword or selector items.
 * @param search - Array of search items to generate headers from.
 * @returns Header map compatible with the plugin's `headers` property.
 */
function toHeader(type: 'keyword' | 'selector', search?: (string | Content)[]) {
	const header: Record<string, string> = {};
	if (!search) {
		return header;
	}

	for (const item of search) {
		if (typeof item === 'string') {
			header[`${type}:${item}`] = `Search ${type}: ${item}`;
			continue;
		}
		header[`${type}:${item.search}`] = item.title;
	}

	return header;
}

/**
 * Recursively searches a DOM subtree for regex matches in text nodes
 * and element attributes.
 *
 * ## Traversal algorithm
 *
 * 1. **Depth-first children first**: For each child node, recurse before
 *    examining the current node. This ensures matches are collected in
 *    document order (deepest nodes first in each subtree).
 *
 * 2. **`<script>` / `<style>` exclusion**: These elements are skipped
 *    entirely (including their children) because their text content is
 *    code, not user-visible content. The check happens *after* recursion
 *    so that nested elements within `<script>` templates are still
 *    excluded via the early return.
 *
 * 3. **Text nodes**: `TEXT_NODE` content is tested against the regex.
 *    The parent element's tag name is recorded for context.
 *
 * 4. **Element attributes**: For `ELEMENT_NODE`, each attribute is tested
 *    except for structural/styling attributes (`href`, `src`, `srcset`,
 *    `id`, `class`, `style`, `d`, `data-*`). These are excluded because
 *    they contain URLs, identifiers, or CSS that would produce false
 *    positives for content-oriented keyword searches.
 * @param el - The root node to search from.
 * @param search - The regex pattern to match against.
 * @returns Array of matches with the element context and matched text.
 */
function recursiveSearch(el: Node, search: RegExp) {
	type Result = {
		el: string;
		text: string;
	};
	const result: Result[] = [];

	for (const child of el.childNodes) {
		result.push(...recursiveSearch(child, search));
	}

	if ('tagName' in el && (el.tagName === 'SCRIPT' || el.tagName === 'STYLE')) {
		return [];
	}

	if (el.nodeType === Node.TEXT_NODE) {
		const textMatched = search.exec(el.textContent || '');

		if (textMatched) {
			for (const matched of textMatched) {
				result.push({
					el: '<' + (el.parentElement?.localName || '???') + '>',
					text: matched,
				});
			}
		}
	}

	if (el.nodeType === Node.ELEMENT_NODE) {
		const _el: Element = el as Element;
		for (const attr of _el.attributes) {
			if (
				['href', 'src', 'srcset', 'id', 'class', 'style', 'd'].includes(attr.name) ||
				attr.name.startsWith('data-')
			) {
				continue;
			}
			const attrMatched = search.exec(attr.value);
			if (attrMatched) {
				for (const matched of attrMatched) {
					result.push({
						el: `${_el.localName}[${attr.localName}]`,
						text: matched,
					});
				}
			}
		}
	}

	return result;
}
