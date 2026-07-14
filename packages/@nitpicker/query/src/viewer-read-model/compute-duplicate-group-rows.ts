import type { Knex } from 'knex';

/** Metadata fields `findDuplicates`/this read model track duplicates for. */
type DuplicateGroupField = 'title' | 'description';

/** One row to insert into `viewer_duplicate_groups`, produced by `computeDuplicateGroupRows`. */
export interface DuplicateGroupInsertRow {
	/**
	 * Sequential id assigned by `computeDuplicateGroupRows` itself, across
	 * both `title` and `description` groups (title groups first, in SQL
	 * `GROUP BY` order, then description groups), inserted verbatim as
	 * `viewer_duplicate_groups`'s `INTEGER PRIMARY KEY`.
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
	 * `count desc` (most-duplicated-first) order.
	 */
	count_desc_key: number;
}

/**
 * Value → `group_id` lookup, one `Map` per {@link DuplicateGroupField},
 * produced by `computeDuplicateGroupRows` and consumed by
 * `computeDuplicateGroupPageRows`.
 */
export type DuplicateGroupIdIndex = Map<DuplicateGroupField, Map<string, number>>;

/**
 * 0.13: reads one `GROUP BY page_meta.<field>_text_id
 * HAVING COUNT(*) > 1` aggregation per {@link DuplicateGroupField} against
 * the 0.13 entity tables. Grouping by the deduped text-ref id (rather
 * than the raw text column previously stored inline on `pages`) preserves
 * the same "same value → same group" semantics while letting SQLite work
 * with narrow integer keys. `text_refs.text` is only joined once, after the
 * group aggregation, to project the display value.
 *
 * The predicate matches `findDuplicates`'s scope
 * (`scraped = 1, is_external = 0, content_type='text/html',
 * redirect_dest_id IS NULL, text_id IS NOT NULL, text != ''`) — the pre-6
 * `.whereNot(field, '')` filter still applies because `text_refs.text` is
 * the same raw text that used to live inline in `pages.title` /
 * `pages.description`.
 *
 * Assigns each group a sequential, 1-based `group_id` across both fields;
 * `viewer_duplicate_group_pages` rows need this id to reference before
 * either table is inserted.
 * @param trx - An open Knex transaction (a plain `Knex` instance also works,
 *   e.g. in tests that don't need transactional rollback).
 * @returns The `viewer_duplicate_groups` insert rows, plus a
 *   `groupIdByValue` lookup.
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
		const textIdColumn = `pm.${field}_text_id`;
		const rows = (await trx('content_items as ci')
			.join('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
			.join('page_meta as pm', 'pm.page_id', 'ci.id')
			.join('text_refs as tr', 'tr.id', textIdColumn)
			.where({ 'ci.scraped': 1, 'ci.is_external': 0, 'ctr.raw': 'text/html' })
			.whereNull('ci.redirect_dest_id')
			.whereNotNull(textIdColumn)
			.whereNot('tr.text', '')
			.groupBy(textIdColumn)
			.having(trx.raw('count(*) > 1'))
			.select(trx.raw('"tr"."text" as value'), trx.raw('count(*) as cnt'))) as {
			value: string;
			cnt: number | string;
		}[];

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
