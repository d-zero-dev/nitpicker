import type { Knex } from 'knex';

import { eachSplitted } from '../utils/array/each-splitted.js';

import { convertLegacyPageTagsToInserts } from './meta/technologies/convert-legacy-page-tags-to-inserts.js';

/**
 * Converts every `page_tags` row (the removed Wappalyzer-only detection
 * table) into `technology_signals` + `page_technologies` rows, then drops
 * `page_tags` — for archives crawled before this feature shipped, which
 * still carry the old table.
 *
 * Unlike every other `migrate*` function in this directory (which add a
 * nullable column and never touch existing tables), this one both writes
 * to two NEW tables and DROPS an old one — because `page_technologies`
 * supersedes `page_tags` outright rather than extending it. The conversion
 * itself is shared with `retarget-legacy-fk-tables.ts`'s special-cased
 * `page_tags` handling (0.10→0.13 upgrade path) via
 * `convertLegacyPageTagsToInserts` — a `page_tags` row converts identically
 * regardless of which migration path produced it.
 *
 * No separate backfill step is needed (v0.x policy: read-time migration
 * only, no retroactive re-crawl): only the `wappalyzer` signal survives the
 * conversion — the structural/`js-license-comment` signals this feature
 * also detects require re-crawling to populate, which is the same
 * "existing archives need a re-crawl for new signal types" trade-off
 * already accepted for this feature.
 *
 * Idempotent: a no-op once `page_tags` is gone (either because this
 * function already ran, or because the archive was crawled after this
 * feature shipped and never had `page_tags` at all).
 *
 * Logs a row count before starting (issue #294): on a large legacy archive
 * this SELECT-all-convert-drop runs as one transaction with no per-chunk
 * progress, so without an upfront count it looks indistinguishable from a
 * hang for however long the conversion actually takes.
 * @param instance - The Knex query builder instance connected to the database.
 * @param onLog - Called instead of `console.error` for both the start and
 *   end notices (issue #294: a bare `console.error` here can fire while a
 *   `@d-zero/dealer` `Lanes`/`TaskList` display is mid-redraw during
 *   `Archive.open`, corrupting its cursor tracking). Falls back to
 *   `console.error` when omitted (direct/test callers).
 */
export async function migratePageTagsToPageTechnologies(
	instance: Knex,
	onLog?: (message: string) => void,
): Promise<void> {
	const hasPageTags = await instance.schema.hasTable('page_tags');
	if (!hasPageTags) return;

	const [row] = await instance('page_tags').count<[{ total: number }]>({ total: '*' });
	const total = row?.total ?? 0;
	const startMessage = `[migrate] converting ${total} page_tags row(s) to technology_signals/page_technologies…`;
	if (onLog) {
		onLog(startMessage);
	} else {
		// eslint-disable-next-line no-console
		console.error(startMessage);
	}

	await instance.transaction(async (trx) => {
		const rows: Array<{
			pageId: number;
			provider: string;
			version: string | null;
			confidence: number | null;
			categories: unknown;
		}> = await trx
			.select('pageId', 'provider', 'version', 'confidence', 'categories')
			.from('page_tags');

		const { signalInserts, technologyInserts } = convertLegacyPageTagsToInserts(rows);

		if (signalInserts.length > 0) {
			await eachSplitted(signalInserts, 100, async (chunk) => {
				await trx('technology_signals').insert(chunk);
			});
		}
		if (technologyInserts.length > 0) {
			await eachSplitted(technologyInserts, 100, async (chunk) => {
				await trx('page_technologies').insert(chunk);
			});
		}

		await trx.schema.dropTable('page_tags');
	});
	const endMessage =
		'[migrate] page_tags converted to technology_signals/page_technologies and dropped';
	if (onLog) {
		onLog(endMessage);
	} else {
		// eslint-disable-next-line no-console
		console.error(endMessage);
	}
}
