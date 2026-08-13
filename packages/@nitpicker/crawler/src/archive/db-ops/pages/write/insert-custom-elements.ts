import type { MainContentCustomElementCandidate } from '../../../../crawler/types.js';
import type { Knex } from 'knex';

import { eachSplitted } from '../../../../utils/array/each-splitted.js';

/**
 * Replaces the page's `page_main_content_custom_elements` rows with the
 * freshly captured set. Called inside `updatePage`'s transaction, gated on
 * `page.mainContentCustomElements !== undefined` by the caller — the caller
 * must NOT call this with a defaulted `[]` when the capture itself failed
 * (`undefined`), since this function cannot tell "capture found nothing"
 * apart from "capture didn't run" once it receives a plain array.
 *
 * Unlike `insertButtons` / `insertHeadings` etc. (whose empty-array case is
 * genuinely ambiguous — beholder's `MainContentsData` gives no way to tell
 * "successfully found zero" from "degraded scrape" — this function always
 * deletes existing rows once called, including for an empty array: because
 * the caller already resolved that ambiguity via the `!== undefined` gate,
 * an empty array here unambiguously means "capture succeeded, found none,"
 * so stale rows from a previous crawl must be cleared.
 *
 * Unlike `insertButtons`, the input is nitpicker's own
 * `MainContentCustomElementCandidate[]` (from `capture-custom-elements.ts`),
 * not a slice of beholder's `MainContentsData` — there is no such category
 * in `MainContentsData`.
 * @param pageId - The owning `content_items.id`.
 * @param customElements - The captured custom elements, in document order.
 * @param trx - The active transaction.
 */
export async function insertCustomElements(
	pageId: number,
	customElements: readonly MainContentCustomElementCandidate[],
	trx: Knex.Transaction,
): Promise<void> {
	await trx('page_main_content_custom_elements').where('pageId', pageId).delete();
	if (customElements.length === 0) return;
	const rows = customElements.map((el, order) => ({
		pageId,
		order,
		nodeName: el.nodeName,
		elementId: el.elementId,
		classList: JSON.stringify(el.classList),
	}));
	await eachSplitted(rows, 100, async (chunk) => {
		await trx('page_main_content_custom_elements').insert(chunk);
	});
}
