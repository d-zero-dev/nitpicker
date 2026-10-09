import type { Knex } from 'knex';

/**
 * Creates the `analysis_text_refs` / `analysis_violations` tables in the shape
 * an archive written by an earlier version carries (FK → `content_items(id)`).
 * Current archives do not create these tables, so specs that exercise the
 * guarded cleanup of legacy archives provision them through this helper.
 * @param db - Knex connected to the test DB (or a transaction).
 * @example
 * await createAdjunctTables(db);
 * await createLegacyAnalysisTables(db);
 * await db('analysis_text_refs').insert({ text: 'msg', sha256: 'abc' });
 */
export async function createLegacyAnalysisTables(db: Knex): Promise<void> {
	await db.raw(`
		CREATE TABLE analysis_text_refs (
			id integer primary key,
			text text not null,
			sha256 text not null,
			unique(sha256, text)
		)
	`);
	await db.raw(`
		CREATE TABLE analysis_violations (
			id integer primary key,
			page_id integer not null references content_items(id),
			validator text not null,
			severity text not null,
			rule text not null,
			message_text_id integer not null references analysis_text_refs(id),
			code_text_id integer references analysis_text_refs(id),
			page_url_sort_key text not null,
			message_sort_key text not null,
			code_sort_key text not null,
			line integer,
			col integer
		)
	`);
}
