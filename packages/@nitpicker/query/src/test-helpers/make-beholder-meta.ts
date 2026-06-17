import type { Meta } from '@d-zero/beholder';

/**
 * Test helper: builds a minimal valid beholder 3.0.0 {@link Meta} object.
 *
 * `Meta` requires six fields (`title`, `jsonLd`, `speculationRules`, `tags`,
 * `others`, `originTrial`). Specs that only care about a subset of meta
 * fields use this helper to populate defaults and spread overrides on top —
 * keeping the noise in test fixtures down.
 *
 * Sub-objects like `link` / `og` / `robots` / `twitter` declare many
 * required arrays (LinkMeta alone has ~50 `Type[]` fields); callers pass
 * partial shapes that get cast via `unknown` so the helper accepts any
 * subset without enumerating every empty array.
 * @param overrides - Partial Meta-like object; permissive on nested shapes.
 */
export function makeBeholderMeta(overrides: Record<string, unknown> = {}): Meta {
	return {
		title: '',
		jsonLd: [],
		speculationRules: [],
		tags: { detected: {}, entries: [] },
		others: {
			meta: {},
			property: {},
			httpEquiv: {},
			itemprop: {},
			link: [],
			script: [],
			iframe: [],
		},
		originTrial: [],
		...overrides,
	} as Meta;
}
