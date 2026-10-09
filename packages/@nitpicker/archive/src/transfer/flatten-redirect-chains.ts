import type { Knex } from 'knex';

/** Default cap on flatten iterations — see {@link flattenRedirectChains}'s docs. */
const DEFAULT_MAX_HOPS = 32;

/**
 * Re-flattens `content_items.redirect_dest_id` to a single hop after
 * concat, breaking any cycle it finds.
 *
 * Every source archive individually satisfies the "redirect destination
 * is always the final hop" invariant (`linkRedirectSources` pre-flattens
 * at write time), but merging two sources can reintroduce a chain: if
 * source A has `P → X` (X external/unresolved in A) and source B's
 * winning row for X is itself `X → Y`, the merged destination now has a
 * two-hop `P → X → Y` — a shape no single crawl ever produces, and every
 * reader in this codebase (`resolveAliasAndRedirectChain`,
 * `list-links.ts`, …) assumes at most one hop.
 *
 * Runs a bounded loop: each pass sets every row's `redirect_dest_id` to
 * its CURRENT target's `redirect_dest_id` when that target itself
 * redirects further, stopping either when a pass changes zero rows or
 * after `maxHops` passes (a cross-source cycle — A→B, B→A — would
 * otherwise loop forever alternating between the two, since neither
 * satisfies "my target has no further redirect"). Any row still part of
 * a chain after the cap, or found to point at itself, is a cycle: its
 * `redirect_dest_id` is set to `NULL` rather than left pointing at a
 * still-chained row.
 *
 * This is whole-archive (not source-scoped) and split-safe: a single,
 * not-yet-merged source is already flat (this function is still called
 * for split too, for uniformity — every pass finds zero rows to change on
 * the first iteration, a cheap no-op).
 * @param trx - The destination transaction (no source ATTACHed — this
 *   runs once, after every source has been transferred, not per-source).
 * @param maxHops - Maximum flatten passes before treating any remaining
 *   chain as a cycle. Defaults to {@link DEFAULT_MAX_HOPS}.
 * @returns The number of rows flattened across every pass, and the number
 *   of cycle rows NULLed out.
 * @example
 * ```ts
 * for (const source of sources) { await transferArchiveRows(...); }
 * const { flattened, cyclesBroken } = await flattenRedirectChains(knex);
 * ```
 */
export async function flattenRedirectChains(
	trx: Knex,
	maxHops = DEFAULT_MAX_HOPS,
): Promise<{ flattened: number; cyclesBroken: number }> {
	let flattened = 0;
	for (let hop = 0; hop < maxHops; hop++) {
		const result = await trx.raw(`
			UPDATE content_items
			SET redirect_dest_id = t.redirect_dest_id
			FROM content_items t
			WHERE t.id = content_items.redirect_dest_id
				AND t.redirect_dest_id IS NOT NULL
				AND t.redirect_dest_id != content_items.id
		`);
		const changes = (result?.changes as number | undefined) ?? 0;
		flattened += changes;
		if (changes === 0) {
			break;
		}
	}

	const selfLoops: { id: number }[] = await trx
		.select('id')
		.from('content_items')
		.whereRaw('redirect_dest_id = id');
	const stillChained: { id: number }[] = await trx
		.select('t1.id as id')
		.from({ t1: 'content_items' })
		.join({ t2: 'content_items' }, 't2.id', 't1.redirect_dest_id')
		.whereNotNull('t1.redirect_dest_id')
		.whereNotNull('t2.redirect_dest_id');
	const cycleIds = [...new Set([...selfLoops, ...stillChained].map((r) => r.id))];
	if (cycleIds.length > 0) {
		await trx('content_items').whereIn('id', cycleIds).update({ redirect_dest_id: null });
	}

	return { flattened, cyclesBroken: cycleIds.length };
}
