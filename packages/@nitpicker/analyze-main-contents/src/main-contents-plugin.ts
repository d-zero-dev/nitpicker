import type { HeadingLevel, Result } from './types.js';

import { finder } from '@medv/finder'; // cspell:disable-line
import { definePlugin } from '@nitpicker/core';

/**
 * Plugin options for the main-contents detection analysis.
 */
type Options = {
	/**
	 * A custom CSS selector to identify the main content element.
	 * When provided, it is prepended to the default selector list
	 * (highest priority) so that the custom selector is tried first.
	 */
	mainContentSelector?: string | null;
};

/**
 * Analyze plugin that detects the main content area of each page and
 * extracts structural metrics: word count, headings, images, and tables.
 *
 * ## Main content detection strategy
 *
 * The plugin uses a priority-ordered list of CSS selectors to locate
 * the main content element. The selectors are joined with commas into
 * a single `document.querySelector()` call, so the browser returns the
 * first matching element in DOM order among all selectors:
 *
 * 1. User-supplied `mainContentSelector` (highest priority, prepended via `unshift`)
 * 2. `<main>` element (semantic HTML5)
 * 3. `[role="main"]` (WAI-ARIA landmark)
 * 4. Common id/class patterns: `#main`, `.main`, `#content`, `.content`,
 *    `#contents`, `.contents`, `#main-content`, `.main-content`,
 *    `#main_content`, `.main_content`, `#mainContent`, `.mainContent`
 *
 * This ordering reflects real-world convention: semantic elements are
 * preferred over id/class-based heuristics, and the user's explicit
 * selector always wins.
 * @example
 * ```jsonc
 * // nitpicker.config.json
 * {
 *   "plugins": {
 *     "analyze": {
 *       "@nitpicker/analyze-main-contents": {
 *         "mainContentSelector": "#page-body"
 *       }
 *     }
 *   }
 * }
 * ```
 */
export default definePlugin((options: Options) => {
	return {
		label: 'メインコンテンツ検出',
		headers: {
			wordCount: 'Word count',
			headings: 'Heading count',
			images: 'Image count',
			table: 'Table count',
		},
		eachPage({ window }) {
			const { document } = window;
			const result: Result = {
				title: document.title?.trim(),
				main: null,
				wordCount: 0,
				headings: [],
				images: [],
				paragraphs: [],
				tables: [],
			};
			// Extract main content using priority-ordered selectors
			const selectors = [
				'main',
				'[role="main"]',
				'#main',
				'.main',
				'#content',
				'.content',
				'#contents',
				'.contents',
				'#main-content',
				'.main-content',
				'#main_content',
				'.main_content',
				'#mainContent',
				'.mainContent',
			];
			if (options.mainContentSelector) {
				selectors.unshift(options.mainContentSelector);
			}
			const $main = document.querySelector(selectors.join(','));

			if (!$main) {
				return {
					wordCount: {
						value: result.wordCount,
					},
					headings: {
						value: result.headings.length,
					},
					images: {
						value: result.images.length,
					},
					table: {
						value: result.tables.length,
					},
				};
			}

			result.main = {
				nodeName: $main.nodeName,
				id: $main.id || null,
				classList: [...$main.classList],
				role: $main.getAttribute('role'),
				selector: finder($main, {
					root: document.body,
				}),
			};

			const textContent = removeSpaces($main.textContent) || '';
			result.wordCount = textContent.length;

			for (const $heading of $main.querySelectorAll<HTMLHeadingElement>(
				'h1, h2, h3, h4, h5, h6',
			)) {
				result.headings.push({
					text: removeSpaces($heading.textContent),
					level: Number.parseInt($heading.nodeName.replace(/h/i, ''), 10) as HeadingLevel,
				});
			}

			for (const $img of $main.querySelectorAll<HTMLImageElement>(
				'img, input[type="image"]',
			)) {
				result.images.push({
					src: $img.src,
					alt: $img.alt,
				});
			}

			for (const $table of $main.querySelectorAll<HTMLTableElement>('table')) {
				result.tables.push({
					rows: $table.querySelectorAll('tr').length,
					cols: $table.querySelector('tr')?.querySelectorAll('th, td').length || 0,
					hasHeader: !!$table.querySelector('thead'),
					hasFooter: !!$table.querySelector('tfoot'),
					hasMergedCell: !!$table.querySelector('[colspan], [rowspan]'),
				});
			}

			return {
				page: {
					wordCount: {
						value: result.wordCount,
					},
					headings: {
						value: result.headings.length,
					},
					images: {
						value: result.images.length,
					},
					table: {
						value: result.tables.length,
						note: [
							'| r | c | h | f | m |',
							...result.tables.map((table) => {
								return `|${table.rows.toString(10).padStart(3, ' ')}| ${table.cols
									.toString(10)
									.padStart(3, ' ')} | ${table.hasHeader ? 'o' : 'x'} | ${
									table.hasFooter ? 'o' : 'x'
								} | ${table.hasMergedCell ? 'o' : 'x'} |`;
							}),
						].join('\n'),
					},
				},
			};
		},
	};
});

/**
 * Strips all whitespace from the given text.
 *
 * Used for word-count calculation: Japanese and CJK text do not use
 * spaces between words, so total character count (after removing
 * formatting whitespace) is a more meaningful metric than word count.
 * @param text - Raw text content (may be `null` for empty elements).
 * @returns The text with all whitespace removed, or `null` if input is empty/null.
 */
function removeSpaces(text: string | null) {
	return text?.trim().replaceAll(/\s+/g, '') || null;
}
