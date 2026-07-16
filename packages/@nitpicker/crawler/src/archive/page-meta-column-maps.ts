import type { FlatPageMetaColumns } from './meta/types.js';

/**
 * Flat-meta-field → `page_meta` FK-column mapping, shared by the two
 * writers that materialise `page_meta` rows: the live-crawl upsert
 * (`db-ops/pages/write/insert-page.ts`) and the archive-migration
 * populate (`populate-entity-tables/populate-page-meta.ts`).
 *
 * The two writers MUST agree on this mapping — a fork would make
 * live-crawled archives and migrated archives disagree on which flat
 * meta field feeds which `page_meta` column for structurally identical
 * inputs. Keeping the single definition here is what enforces that;
 * adding, renaming, or removing a flat meta column is a one-place edit.
 *
 * - `text`: text-shaped columns mapped 1:1 to `<name>_text_id` FKs into
 *   `text_refs`.
 * - `url`: URL-shaped columns mapped 1:1 to `<name>_url_id` FKs into
 *   `url_refs`.
 * @example
 * for (const { source, target } of PAGE_META_COLUMN_MAPS.text) {
 *   row[target] = textIds.get(flat[source]) ?? null;
 * }
 */
export const PAGE_META_COLUMN_MAPS: {
	readonly text: readonly { source: keyof FlatPageMetaColumns; target: string }[];
	readonly url: readonly { source: keyof FlatPageMetaColumns; target: string }[];
} = {
	text: [
		{ source: 'title', target: 'title_text_id' },
		{ source: 'description', target: 'description_text_id' },
		{ source: 'keywords', target: 'keywords_text_id' },
		{ source: 'robots_raw', target: 'robots_raw_text_id' },
		{ source: 'og_title', target: 'og_title_text_id' },
		{ source: 'og_description', target: 'og_description_text_id' },
		{ source: 'twitter_title', target: 'twitter_title_text_id' },
		{ source: 'twitter_description', target: 'twitter_description_text_id' },
	],
	url: [
		{ source: 'canonical', target: 'canonical_url_id' },
		{ source: 'amphtml', target: 'amphtml_url_id' },
		{ source: 'manifest', target: 'manifest_url_id' },
		{ source: 'icon_href', target: 'icon_url_id' },
		{ source: 'appleTouchIcon_href', target: 'apple_touch_icon_url_id' },
		{ source: 'og_url', target: 'og_url_id' },
		{ source: 'og_image', target: 'og_image_url_id' },
		{ source: 'twitter_image', target: 'twitter_image_url_id' },
	],
};
