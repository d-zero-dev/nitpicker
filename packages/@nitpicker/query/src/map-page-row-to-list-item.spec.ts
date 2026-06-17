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
		firstCrawledAt: null,
		lastCrawledAt: null,
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

	it('PAGE_LIST_COLUMNS matches the row interface keys', () => {
		const row = makeRow();
		const rowKeys = Object.keys(row).toSorted();
		const cols = [...PAGE_LIST_COLUMNS].toSorted();
		expect(cols).toEqual(rowKeys);
	});
});
