import type { Knex } from 'knex';

/**
 * Deletes every Scoped-Replace derived row for the given page ids, across the
 * 17 tables a page's re-scrape needs to start clean.
 *
 * Shared by {@link resetFailedPages} and {@link repromoteExternalPages} —
 * both un-scrape a page back to `scraped = 0` and need the same "delete this
 * page's derived rows so the re-scrape can re-insert fresh data without
 * duplicates" sweep. `page_errors` is deliberately NOT included here:
 * `repromoteExternalPages` never cleared it (an external page's prior error
 * history stays visible after being promoted back into scope), and folding
 * it into this shared helper would silently change that existing behaviour.
 * Callers that do want `page_errors` cleared (`resetFailedPages`) delete it
 * themselves alongside this call.
 * @param knex - Knex query builder connected to the archive DB.
 * @param pageIds - `content_items.id` values whose derived rows should be
 *   deleted. Expected to already be chunked below
 *   `SQLITE_LIMIT_VARIABLE_NUMBER` by the caller.
 */
export async function clearPageDerivedRows(
	knex: Knex,
	pageIds: readonly number[],
): Promise<void> {
	await knex('page_meta').whereIn('page_id', pageIds).delete();
	await knex('anchor_edges').whereIn('page_id', pageIds).delete();
	await knex('image_items').whereIn('page_id', pageIds).delete();
	await knex('resource_ref_edges').whereIn('page_id', pageIds).delete();
	await knex('page_html_ref').whereIn('page_id', pageIds).delete();
	await knex('technology_signals').whereIn('pageId', pageIds).delete();
	await knex('page_technologies').whereIn('pageId', pageIds).delete();
	await knex('page_jsonld').whereIn('pageId', pageIds).delete();
	await knex('page_main_content_headings').whereIn('pageId', pageIds).delete();
	await knex('page_main_content_images').whereIn('pageId', pageIds).delete();
	await knex('page_main_content_tables').whereIn('pageId', pageIds).delete();
	await knex('page_main_content_buttons').whereIn('pageId', pageIds).delete();
	await knex('page_main_content_iframes').whereIn('pageId', pageIds).delete();
	await knex('page_main_content_videos').whereIn('pageId', pageIds).delete();
	await knex('page_main_content_audios').whereIn('pageId', pageIds).delete();
	await knex('page_main_content_canvases').whereIn('pageId', pageIds).delete();
	await knex('page_main_content_custom_elements').whereIn('pageId', pageIds).delete();
}
