import type { Knex } from 'knex';

/**
 * Follows `content_items.redirect_dest_id` / `alias_of_id` from `startId` to
 * its final representative, one hop at a time, preferring `redirect_dest_id`
 * over `alias_of_id` at each step.
 *
 * `redirect_dest_id` is pre-flattened to its final HTTP destination at write
 * time and `alias_of_id` never chains beyond one hop on its own (Union-Find
 * already collapses every alias group to a single representative whose own
 * `alias_of_id` is `NULL`) — but a redirect's destination row can itself be
 * a non-representative alias member of a *different* group, since
 * `backfillAliasOfId`'s candidate selection only excludes rows that are
 * redirect *sources*, not rows a redirect *lands on*. Walking one hop at a
 * time (rather than reading both columns once) is what catches that case.
 * @param knex - Knex instance.
 * @param startId - The `content_items.id` to start resolving from.
 * @returns The final representative's `content_items.id`. Returns `startId`
 *   itself if it has neither column set, or if a cycle is detected.
 * @example
 * const targetId = await resolveAliasAndRedirectChain(knex, candidateId);
 */
export async function resolveAliasAndRedirectChain(
	knex: Knex,
	startId: number,
): Promise<number> {
	const visited = new Set<number>([startId]);
	let currentId = startId;
	for (;;) {
		const row = (await knex('content_items')
			.select('redirect_dest_id as redirectDestId', 'alias_of_id as aliasOfId')
			.where('id', currentId)
			.first()) as
			| { redirectDestId: number | null; aliasOfId: number | null }
			| undefined;
		const nextId = row?.redirectDestId ?? row?.aliasOfId;
		if (nextId == null || visited.has(nextId)) {
			return currentId;
		}
		visited.add(nextId);
		currentId = nextId;
	}
}
