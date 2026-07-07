import type { Knex } from 'knex';

/** Metadata fields `findDuplicates`/this read model track duplicates for. */
type DuplicateGroupField = 'title' | 'description';

/** One row to insert into `viewer_duplicate_groups`, produced by `computeDuplicateGroupRows`. */
export interface DuplicateGroupInsertRow {
	/**
	 * Sequential id assigned by `computeDuplicateGroupRows` itself, across
	 * both `title` and `description` groups (title groups first, in SQL
	 * `GROUP BY` order, then description groups), inserted verbatim as
	 * `viewer_duplicate_groups`'s `INTEGER PRIMARY KEY` — the same
	 * `buildDirectoryTreeRows`-style "JS assigns ids at build time" pattern
	 * `viewer_directory_nodes.node_id` uses, needed here because
	 * `viewer_duplicate_group_pages` rows must reference this id before
	 * either table is inserted.
	 */
	group_id: number;
	/** Which metadata field this group is duplicated on. */
	field: DuplicateGroupField;
	/** The shared value every member page carries. */
	value: string;
	/** Total number of pages sharing this value. */
	count: number;
	/**
	 * The negation of `count` — walking this column ascending yields
	 * `count desc` (most-duplicated-first) order, the same
	 * `viewer_anchor_facts.status_desc_key`/`viewer_pages.status_desc_key`
	 * sign-flipped-integer convention.
	 */
	count_desc_key: number;
}

/**
 * Value → `group_id` lookup, one `Map` per {@link DuplicateGroupField},
 * produced by `computeDuplicateGroupRows` and consumed by
 * `computeDuplicateGroupPageRows` to match each scanned `pages` row's
 * `title`/`description` back to the group it belongs to (if any).
 */
export type DuplicateGroupIdIndex = Map<DuplicateGroupField, Map<string, number>>;

/**
 * Reads one `GROUP BY <field> HAVING COUNT(*) > 1` aggregation per
 * {@link DuplicateGroupField} — the exact predicate `findDuplicates` itself
 * uses (`scraped = 1, isExternal = 0, contentType = 'text/html'`,
 * `redirectDestId IS NULL`, non-null/non-empty `field`) — but without
 * `findDuplicates`'s `GROUP_CONCAT(url, ...)`/`LIMIT`: this read-model build
 * step needs every duplicate group's `{field, value, count}`, not a
 * capped/URL-bearing top-N page. Member page URLs are resolved separately by
 * `computeDuplicateGroupPageRows`'s own `pages` scan, avoiding the unbounded
 * string concatenation an archive-wide `GROUP_CONCAT` would otherwise risk.
 *
 * Like `computeHeaderCheckInsertRows`, this returns a plain array rather than
 * an `AsyncGenerator`: the number of distinct duplicate VALUES is bounded far
 * below the number of `pages` rows (only actually-duplicated titles/
 * descriptions produce a row here), so there is no OOM risk to chunk against.
 *
 * Assigns each group a sequential, 1-based `group_id` across both fields —
 * mirroring `buildDirectoryTreeRows`'s `nextNodeId` pattern:
 * `viewer_duplicate_group_pages` rows need a `group_id` to reference before
 * either table is inserted, so the id must be assigned by this JS step
 * rather than left to SQLite's own `AUTOINCREMENT`.
 * @param trx - An open Knex transaction (a plain `Knex` instance also works,
 *   e.g. in tests that don't need transactional rollback).
 * @returns The `viewer_duplicate_groups` insert rows, plus a
 *   `groupIdByValue` lookup — pass this straight into
 *   `computeDuplicateGroupPageRows`.
 * @example
 * const { groups, groupIdByValue } = await computeDuplicateGroupRows(trx);
 * await trx('viewer_duplicate_groups').insert(groups);
 * for await (const chunk of computeDuplicateGroupPageRows(trx, groupIdByValue)) {
 *   await trx('viewer_duplicate_group_pages').insert(chunk);
 * }
 */
export async function computeDuplicateGroupRows(trx: Knex): Promise<{
	groups: DuplicateGroupInsertRow[];
	groupIdByValue: DuplicateGroupIdIndex;
}> {
	const fields: DuplicateGroupField[] = ['title', 'description'];
	const groups: DuplicateGroupInsertRow[] = [];
	const groupIdByValue: DuplicateGroupIdIndex = new Map([
		['title', new Map<string, number>()],
		['description', new Map<string, number>()],
	]);

	let nextGroupId = 1;
	for (const field of fields) {
		const rows = (await trx('pages')
			.select(trx.raw('?? as value', [field]), trx.raw('count(*) as cnt'))
			.where({ scraped: 1, isExternal: 0, contentType: 'text/html' })
			.whereNull('redirectDestId')
			.whereNotNull(field)
			.whereNot(field, '')
			.groupBy(field)
			.having('cnt', '>', 1)) as { value: string; cnt: number | string }[];

		const valueToGroupId = groupIdByValue.get(field)!;
		for (const row of rows) {
			const count = Number(row.cnt);
			const groupId = nextGroupId++;
			groups.push({
				group_id: groupId,
				field,
				value: row.value,
				count,
				count_desc_key: -count,
			});
			valueToGroupId.set(row.value, groupId);
		}
	}

	return { groups, groupIdByValue };
}
