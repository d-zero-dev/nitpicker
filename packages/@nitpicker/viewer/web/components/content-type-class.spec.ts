import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTENT_TYPE_CATEGORIES } from '@nitpicker/query/categories';
import { describe, expect, it } from 'vitest';

import { contentTypeBarClass } from './content-type-class.js';

const STYLES_PATH = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
	'styles.css',
);

describe('contentTypeBarClass', () => {
	it('returns the composed class name for the html category', () => {
		expect(contentTypeBarClass('html')).toBe('bar-segment bar-segment-html');
	});

	it('returns the composed class name for the unknown fall-through bucket', () => {
		expect(contentTypeBarClass('unknown')).toBe('bar-segment bar-segment-unknown');
	});

	it('always starts with the base segment class so layout rules apply', () => {
		for (const category of CONTENT_TYPE_CATEGORIES) {
			const composed = contentTypeBarClass(category);
			expect(composed.startsWith('bar-segment ')).toBe(true);
			expect(composed.endsWith(`bar-segment-${category}`)).toBe(true);
		}
	});

	/* `styles.css` is the single source of truth for the color + pattern of
	   each category. JS only emits the class; CSS paints the segment. If a
	   new ContentTypeCategory ships without a matching rule, every segment
	   for that category renders with the default `var(--accent)` fill and
	   the user sees a meaningless slab — this spec is the regression net. */
	it('has a corresponding `.bar-segment-<category>` rule in styles.css for every category', async () => {
		const css = await readFile(STYLES_PATH, 'utf8');
		for (const category of CONTENT_TYPE_CATEGORIES) {
			/* `(?![-a-z0-9])` guards against silent prefix collisions: were
			   a future category named `text-strict` introduced alongside
			   `text`, an unbounded `text` match would silently pass on
			   `.bar-segment-text-strict {`. The lookahead requires that
			   the category name end at a non-identifier character. */
			const pattern = new RegExp(`\\.bar-segment-${category}(?![-a-z0-9])\\s*\\{`);
			expect(css).toMatch(pattern);
		}
	});

	/* Two categories painted with the same fill color defeat the legend.
	   `--ct-color: #xxxxxx;` (in the form the styles.css rules use) is
	   easy to extract per-category and dedupe. The CONTENT_TYPE_CATEGORIES
	   array drives the iteration so adding a category without picking a
	   distinct color trips this spec. */
	it('uses a unique `--ct-color` per category', async () => {
		const css = await readFile(STYLES_PATH, 'utf8');
		const colorByCategory = new Map<string, string>();
		for (const category of CONTENT_TYPE_CATEGORIES) {
			const rule = new RegExp(
				`\\.bar-segment-${category}(?![-a-z0-9])\\s*\\{[^}]*--ct-color:\\s*([^;]+);`,
				's',
			);
			const match = css.match(rule);
			expect(match, `missing --ct-color for ${category}`).not.toBeNull();
			const color = match![1].trim().toLowerCase();
			colorByCategory.set(category, color);
		}
		const uniqueColors = new Set(colorByCategory.values());
		expect(uniqueColors.size).toBe(colorByCategory.size);
	});
});
