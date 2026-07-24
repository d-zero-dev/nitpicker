import type { PageListRow } from './types.js';

import { describe, it, expect } from 'vitest';

import { mapPageRowToListItem, PAGE_LIST_COLUMNS } from './map-page-row-to-list-item.js';

/**
 * Builds a {@link PageListRow} with all columns nulled / zeroed.
 * @param overrides
 */
function makeRow(overrides: Partial<PageListRow> = {}): PageListRow {
	return {
		url: 'https://example.com/',
		title: null,
		status: null,
		contentType: null,
		isExternal: 0,
		description: null,
		keywords: null,
		lang: null,
		charset: null,
		themeColor: null,
		manifest: null,
		robots_raw: null,
		robots_noindex: null,
		robots_nofollow: null,
		robots_noarchive: null,
		canonical: null,
		og_type: null,
		og_title: null,
		og_site_name: null,
		og_description: null,
		og_url: null,
		og_image: null,
		og_image_alt: null,
		og_locale: null,
		og_article_published_time: null,
		twitter_card: null,
		twitter_site: null,
		twitter_creator: null,
		twitter_image: null,
		tag_count: null,
		jsonld_count: null,
		tags_providers_csv: null,
		main_content_node_name: null,
		main_content_id: null,
		main_content_role: null,
		main_content_selector: null,
		main_content_class_list: null,
		main_content_word_count: null,
		main_content_body_word_count: null,
		main_content_heading_count: null,
		main_content_image_count: null,
		main_content_table_count: null,
		main_content_button_count: null,
		main_content_iframe_count: null,
		main_content_video_count: null,
		main_content_audio_count: null,
		main_content_canvas_count: null,
		scroll_height_desktop: null,
		scroll_height_mobile: null,
		firstCrawledAt: null,
		lastCrawledAt: null,
		hasCSP: 0,
		hasXFrameOptions: 0,
		hasXContentTypeOptions: 0,
		hasHSTS: 0,
		templateKey: null,
		...overrides,
	};
}

describe('mapPageRowToListItem', () => {
	it('camel-cases snake-case column names', () => {
		const out = mapPageRowToListItem(
			makeRow({
				og_title: 'OG',
				og_image_alt: 'alt',
				robots_raw: 'noindex',
				robots_noindex: 1,
				twitter_card: 'summary',
				tag_count: 3,
			}),
		);
		expect(out.ogTitle).toBe('OG');
		expect(out.ogImageAlt).toBe('alt');
		expect(out.robotsRaw).toBe('noindex');
		expect(out.noindex).toBe(true);
		expect(out.twitterCard).toBe('summary');
		expect(out.tagCount).toBe(3);
	});

	it('converts SQLite 0/1 to booleans', () => {
		const out = mapPageRowToListItem(makeRow({ isExternal: 1, robots_nofollow: 1 }));
		expect(out.isExternal).toBe(true);
		expect(out.nofollow).toBe(true);
	});

	it('treats null robots_* as false', () => {
		const out = mapPageRowToListItem(makeRow());
		expect(out.noindex).toBe(false);
		expect(out.nofollow).toBe(false);
		expect(out.noarchive).toBe(false);
	});

	it('treats empty string description as not present', () => {
		const out = mapPageRowToListItem(makeRow({ description: '' }));
		expect(out.hasDescription).toBe(false);
	});

	it('PAGE_LIST_COLUMNS plus the SQL-computed/joined-only columns match the row interface keys', () => {
		// hasCSP/hasXFrameOptions/hasXContentTypeOptions/hasHSTS are NOT plain
		// `pages` columns — they're computed via `buildHeaderPresenceSelects`
		// (SQL CASE WHEN expressions aliased to these names). templateKey comes
		// from a `page_templates` LEFT JOIN present only in the 0.13 query
		// paths. All are absent from PAGE_LIST_COLUMNS (the legacy pre-0.13
		// column list) but still present on the row shape.
		const row = makeRow();
		const rowKeys = Object.keys(row).toSorted();
		const cols = [
			...PAGE_LIST_COLUMNS,
			'hasCSP',
			'hasXFrameOptions',
			'hasXContentTypeOptions',
			'hasHSTS',
			'templateKey',
		].toSorted();
		expect(cols).toEqual(rowKeys);
	});

	it('converts SQL-computed header presence columns to booleans', () => {
		const out = mapPageRowToListItem(makeRow({ hasCSP: 1, hasHSTS: 1 }));
		expect(out.hasCSP).toBe(true);
		expect(out.hasXFrameOptions).toBe(false);
		expect(out.hasXContentTypeOptions).toBe(false);
		expect(out.hasHSTS).toBe(true);
	});
});
