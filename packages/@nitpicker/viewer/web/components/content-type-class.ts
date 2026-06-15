import type { ContentTypeCategory } from '@nitpicker/query/categories';

/**
 * Returns the CSS class name that paints a stacked-bar segment / legend swatch
 * for the given content-type category.
 *
 * The color + pattern mapping lives entirely in `styles.css`
 * (`.bar-segment-<category>` rules). Keeping the visual definition in CSS
 * means swatches in the legend and segments in the bar are guaranteed to
 * stay in sync — they both go through this helper to compose the class
 * name, and `styles.css` is the single source of truth for the fill.
 *
 * The category is part of the class name verbatim, so adding a new
 * {@link ContentTypeCategory} member requires adding a matching
 * `.bar-segment-<new>` rule in `styles.css`. The CSS-coverage spec
 * (`content-type-class.spec.ts`) fails the build if a category is missing
 * a rule.
 * @param category - The content-type category.
 * @returns The CSS class name (e.g. `bar-segment-html`).
 */
export function contentTypeBarClass(category: ContentTypeCategory): string {
	return `bar-segment bar-segment-${category}`;
}
