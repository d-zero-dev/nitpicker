import type { DuplicateGroupIdIndex } from './compute-duplicate-group-rows.js';
import type { Knex } from 'knex';

/** Rows read per `pages` id-keyset scan chunk, by default. */
const READ_CHUNK_SIZE = 20_000;

/** One row to insert into `viewer_duplicate_group_pages`, produced by `computeDuplicateGroupPageRows`. */
export interface DuplicateGroupPageInsertRow {
	/** The owning group's `group_id` — a `DuplicateGroupInsertRow.group_id`. */
	group_id: number;
	/** The write-model `pages.id` this row represents. */
	page_id: number;
	/**
	 * The member page's URL, verbatim — the same "inline the sort key as
	 * text" convention `viewer_pages.url_sort_key` uses.
	 */
	url_sort_key: string;
}

/** One raw `pages` row read per id-keyset scan chunk, before matching against `groupIdByValue`. */
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
		const rows: DuplicateGroupPageSourceRow[] = await trx('pages')
			.where('pages.id', '>', lastId)
			.where({ scraped: 1, isExternal: 0, contentType: 'text/html' })
			.whereNull('redirectDestId')
			.orderBy('pages.id', 'asc')
			.limit(chunkSize)
			.select(
				'pages.id as id',
				'pages.url as url',
				'pages.title as title',
				'pages.description as description',
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
