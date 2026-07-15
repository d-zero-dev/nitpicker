import type { Knex } from 'knex';

import { computeContentHash } from './compute-content-hash.js';

/**
 * Number of `text_refs` rows sent per `INSERT ... VALUES (...)` statement.
 * Each row binds 2 params (hash + text), so 500 rows = 1000 params — well
 * under SQLite's default `SQLITE_MAX_VARIABLE_NUMBER`.
 */
const INSERT_CHUNK_SIZE = 500;

/**
 * Rows scanned per keyset-paginated `SELECT` chunk. One SELECT reads all
 * text columns for the source table's chunk simultaneously so the pages
 * table is scanned exactly once per populate call, not N-times-once-per-
 * text-column.
 */
const READ_CHUNK_SIZE = 5000;

/**
 * Source table + its text-shaped columns. Groups by table so each table
 * is scanned exactly once with a single SELECT that covers every
 * relevant column — the per-column-scan variant used to run 8 separate
 * pages scans and multiplied migration wall-clock accordingly.
 *
 * `dom_path` is intentionally absent: dom_path strings are derived from
 * the stored HTML blob, not from any column of the current write-model,
 * so this scan has nothing to read. Upserting dom_path strings into
 * `text_refs` is the job of the image-items populate
 * (`populate-entity-tables/populate-image-items.ts`), not this pass.
 */
const TEXT_SOURCES: readonly {
	table: 'anchors' | 'images' | 'pages';
	columns: readonly string[];
}[] = [
	{ table: 'anchors', columns: ['textContent'] },
	{ table: 'images', columns: ['alt'] },
	{
		table: 'pages',
		columns: [
			'title',
			'description',
			'keywords',
			'robots_raw',
			'og_title',
			'og_description',
			'twitter_title',
			'twitter_description',
		],
	},
];

/**
 * Populates `text_refs` from every text-shaped column across `anchors`,
 * `images`, and `pages` (issue #191).
 *
 * Rules:
 *
 * - **Content-hash dedup contract**: identical text produces one row. The
 *   hash is derived by {@link computeContentHash} (currently SHA-256,
 *   matching `page_html_blobs.hash`; see that function's docs for the
 *   algorithm-choice rationale).
 * - **Empty and null are skipped** — an empty `<a>` tag adds no text to
 *   the dictionary. Anchors with no text still get an `anchor_edges` row
 *   in 0.13, just with `first_text_id = NULL`.
 * - **INSERT OR IGNORE on (hash, text)** — the composite UNIQUE from the
 *   0.13 DDL — makes the step idempotent across partial-failure
 *   restarts.
 *
 * Peak memory is bounded by the count of distinct texts (all texts are
 * held in a Map before insert). On the reference archive this Map is
 * about 5 MB of anchor textContent + a few MB of page meta text — well
 * within the migration process budget.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @example
 * await knex.transaction(async (trx) => {
 *   await populateTextRefs(trx);
 * });
 */
export async function populateTextRefs(trx: Knex): Promise<void> {
	const seen = new Map<string, string>();

	for (const source of TEXT_SOURCES) {
		const hasTable = await trx.schema.hasTable(source.table);
		if (!hasTable) {
			continue;
		}
		const presentColumns: string[] = [];
		for (const column of source.columns) {
			if (await trx.schema.hasColumn(source.table, column)) {
				presentColumns.push(column);
			}
		}
		if (presentColumns.length === 0) {
			continue;
		}

		let cursor = 0;
		while (true) {
			const rows: Record<string, unknown>[] = await trx(source.table)
				.select('id', ...presentColumns)
				.where('id', '>', cursor)
				.orderBy('id', 'asc')
				.limit(READ_CHUNK_SIZE);
			if (rows.length === 0) {
				break;
			}
			cursor = rows.at(-1)!.id as number;
			for (const row of rows) {
				for (const column of presentColumns) {
					const value = row[column];
					if (typeof value !== 'string' || value === '') {
						continue;
					}
					const hash = computeContentHash(value);
					const key = hash.toString('hex');
					if (!seen.has(key)) {
						seen.set(key, value);
					}
				}
			}
		}
	}

	if (seen.size === 0) {
		return;
	}

	const inserts: { hash: Buffer; text: string }[] = [];
	for (const [hex, text] of seen) {
		inserts.push({ hash: Buffer.from(hex, 'hex'), text });
	}

	for (let index = 0; index < inserts.length; index += INSERT_CHUNK_SIZE) {
		const chunk = inserts.slice(index, index + INSERT_CHUNK_SIZE);
		await trx('text_refs').insert(chunk).onConflict(['hash', 'text']).ignore();
	}
}
