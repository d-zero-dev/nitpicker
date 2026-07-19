import type { DuplicateGroupIdIndex } from './compute-duplicate-group-rows.js';
import type { Knex } from 'knex';

/** Rows read per `content_items` id-keyset scan chunk, by default. */
const READ_CHUNK_SIZE = 20_000;

/** One row to insert into `viewer_duplicate_group_pages`, produced by `computeDuplicateGroupPageRows`. */
export interface DuplicateGroupPageInsertRow {
	/** The owning group's `group_id` — a `DuplicateGroupInsertRow.group_id`. */
	group_id: number;
	/** The write-model page id (== `content_items.id` == legacy `pages.id`) this row represents. */
	page_id: number;
	/**
	 * The member page's URL, verbatim — the same "inline the sort key as
	 * text" convention `viewer_pages.url_sort_key` uses.
	 */
	url_sort_key: string;
}

/** One raw source row read per id-keyset scan chunk, before matching against `groupIdByValue`. */
interface DuplicateGroupPageSourceRow {
	id: number;
	url: string;
	title: string | null;
	description: string | null;
}

/**
 * Scans `pages` in `id`-keyset-bounded chunks (the same
 * `WHERE pages.id > :last ORDER BY pages.id LIMIT :size` idiom
 * `computeResourceInsertRows` uses), matching each row's `title`/
 * `description` against `groupIdByValue` (produced by
 * `computeDuplicateGroupRows`) to emit one `viewer_duplicate_group_pages` row
 * per (page, matching field) pair — a page duplicated on BOTH `title` and
 * `description` emits two rows in the same chunk.
 *
 * Reads the same base predicate `findDuplicates`/`computeDuplicateGroupRows`
 * use (`scraped = 1, isExternal = 0, contentType = 'text/html',
 * redirectDestId IS NULL`) but without the `whereNotNull`/`whereNot('', ...)`
 * guards on `title`/`description` themselves — a row can only ever match a
 * `groupIdByValue` entry if its value is one of the non-null, non-empty
 * duplicate values `computeDuplicateGroupRows` already found, so repeating
 * that SQL filter here would be redundant, not incorrect.
 *
 * Short-circuits to an empty generator (no `pages` scan at all) when
 * `groupIdByValue` holds no duplicate values for either field — the common
 * case on an archive with no metadata duplicates.
 * @param trx - An open Knex transaction (a plain `Knex` instance also works,
 *   e.g. in tests).
 * @param groupIdByValue - The `title`/`description` value→`group_id` lookup
 *   returned by `computeDuplicateGroupRows`.
 * @param chunkSize - Maximum `pages` rows read per chunk. Must be positive —
 *   `.limit(0)` would return zero rows on the very first iteration
 *   (indistinguishable from "no more pages", so the generator would silently
 *   yield nothing instead of throwing), and SQLite treats a negative `LIMIT`
 *   as unlimited (silently reintroducing the unbounded single-query read
 *   this chunking exists to avoid). Defaults to {@link READ_CHUNK_SIZE};
 *   overridable for tests that need to exercise chunk boundaries against a
 *   small fixture.
 * @yields {DuplicateGroupPageInsertRow[]} One chunk's insert rows for
 *   `viewer_duplicate_group_pages` — up to `2 * chunkSize` rows long if every
 *   page in the chunk duplicates on both `title` and `description`.
 * @throws {RangeError} If `chunkSize` is not positive.
 * @example
 * for await (const chunk of computeDuplicateGroupPageRows(trx, groupIdByValue)) {
 *   await trx('viewer_duplicate_group_pages').insert(chunk);
 * }
 */
export async function* computeDuplicateGroupPageRows(
	trx: Knex,
	groupIdByValue: DuplicateGroupIdIndex,
	chunkSize = READ_CHUNK_SIZE,
): AsyncGenerator<DuplicateGroupPageInsertRow[]> {
	if (chunkSize <= 0) {
		throw new RangeError(
			`computeDuplicateGroupPageRows: chunkSize must be positive, got ${chunkSize}`,
		);
	}

	const titleGroups = groupIdByValue.get('title');
	const descriptionGroups = groupIdByValue.get('description');
	if (
		(!titleGroups || titleGroups.size === 0) &&
		(!descriptionGroups || descriptionGroups.size === 0)
	) {
		return;
	}

	let lastId = 0;
	for (;;) {
		const rows: DuplicateGroupPageSourceRow[] = await trx('content_items as ci')
			.join('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
			.join('page_meta as pm', 'pm.page_id', 'ci.id')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.leftJoin('text_refs as title_ref', 'title_ref.id', 'pm.title_text_id')
			.leftJoin(
				'text_refs as description_ref',
				'description_ref.id',
				'pm.description_text_id',
			)
			.where('ci.id', '>', lastId)
			.where({ 'ci.scraped': 1, 'ci.is_external': 0, 'ctr.raw': 'text/html' })
			.whereNull('ci.redirect_dest_id')
			.orderBy('ci.id', 'asc')
			.limit(chunkSize)
			.select(
				'ci.id as id',
				'ur.url as url',
				'title_ref.text as title',
				'description_ref.text as description',
			);

		if (rows.length === 0) {
			return;
		}
		lastId = rows.at(-1)!.id;

		const chunk: DuplicateGroupPageInsertRow[] = [];
		for (const row of rows) {
			if (row.title != null && titleGroups) {
				const groupId = titleGroups.get(row.title);
				if (groupId != null) {
					chunk.push({ group_id: groupId, page_id: row.id, url_sort_key: row.url });
				}
			}
			if (row.description != null && descriptionGroups) {
				const groupId = descriptionGroups.get(row.description);
				if (groupId != null) {
					chunk.push({ group_id: groupId, page_id: row.id, url_sort_key: row.url });
				}
			}
		}
		yield chunk;
	}
}
