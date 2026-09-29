/**
 * Every page-scoped table whose only FK column is its own page reference
 * — no dictionary or cross-entity FK columns to remap, so every other
 * column passes through unchanged. Covers the 9
 * beholder-`MainContentsData` sub-entity tables, the technology-detection
 * pair (always updated together, per ARCHITECTURE.md's pairing
 * invariant — copying both in the same call keeps that true here too),
 * `page_jsonld`, `page_errors`, and `page_templates` (`template_key` is a
 * plain string column, not a dictionary FK — see
 * `copy-page-template-clusters.ts` for its paired cluster-evidence table).
 *
 * Shared between {@link import('./copy-simple-page-scoped-tables.js').copySimplePageScopedTables}
 * (what to copy verbatim) and
 * {@link import('./clear-replaced-page-rows.js').clearReplacedPageRows}
 * (a subset of what to delete for a `replace`d page) — a single list here
 * means a future page-scoped table only needs adding in one place to stay
 * consistent between the two operations.
 */
export const SIMPLE_PAGE_SCOPED_TABLES: readonly { table: string; pageColumn: string }[] =
	[
		{ table: 'page_main_content_headings', pageColumn: 'pageId' },
		{ table: 'page_main_content_images', pageColumn: 'pageId' },
		{ table: 'page_main_content_tables', pageColumn: 'pageId' },
		{ table: 'page_main_content_buttons', pageColumn: 'pageId' },
		{ table: 'page_main_content_iframes', pageColumn: 'pageId' },
		{ table: 'page_main_content_videos', pageColumn: 'pageId' },
		{ table: 'page_main_content_audios', pageColumn: 'pageId' },
		{ table: 'page_main_content_canvases', pageColumn: 'pageId' },
		{ table: 'page_main_content_custom_elements', pageColumn: 'pageId' },
		{ table: 'technology_signals', pageColumn: 'pageId' },
		{ table: 'page_technologies', pageColumn: 'pageId' },
		{ table: 'page_jsonld', pageColumn: 'pageId' },
		{ table: 'page_errors', pageColumn: 'pageId' },
		{ table: 'page_templates', pageColumn: 'page_id' },
	];
