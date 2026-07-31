import type { Knex } from 'knex';

/**
 * Every distinct `dedupe_cap_events.shape_key` recorded in this archive —
 * used by `CrawlerOrchestrator` to preload `DedupeCapTracker`'s sticky set
 * on `--resume` / `--append` / `--retry-failed` / `--inventory`, so a trap
 * this crawl already paid the cost of discovering once is not re-admitted
 * in a later session. Fresh (non-resuming) crawls do not call this — there
 * is no archive history to seed from.
 *
 * Unlike `listDnsBurnedHostCandidates`, no additional exclusion logic is
 * needed: once `DedupeCapTracker` confirms a shape as a trap, it stays
 * confirmed — there is no equivalent of "the host might have recovered
 * since".
 *
 * Returns `[]` on legacy archives that pre-date the `dedupe_cap_events`
 * table (self-healed on next writer open, so this is never a permanent
 * state) or that have recorded no capped shapes.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns Distinct shape keys already confirmed capped.
 */
export async function listDedupeCapShapeKeys(knex: Knex): Promise<string[]> {
	const hasTable = await knex.schema.hasTable('dedupe_cap_events');
	if (!hasTable) {
		return [];
	}
	const rows = (await knex('dedupe_cap_events').distinct('shape_key')) as {
		shape_key: string;
	}[];
	return rows.map((row) => row.shape_key);
}
