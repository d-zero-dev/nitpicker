import Archive from '@nitpicker/archive/archive';

/**
 * Snapshot of the DDL earlier versions used for the analyze-output tables
 * (`analysis_violations` carries an FK to `content_items(id)`). Frozen here
 * because the current schema no longer creates these tables, yet archives
 * written by earlier versions still contain them.
 */
const LEGACY_ANALYSIS_DDL = [
	`CREATE TABLE analysis_text_refs (
		id integer primary key,
		text text not null,
		sha256 text not null,
		unique(sha256, text)
	)`,
	`CREATE TABLE analysis_violations (
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
	)`,
	'CREATE INDEX av_url_order ON analysis_violations(page_url_sort_key, id)',
	'CREATE INDEX av_filter_url ON analysis_violations(validator, severity, rule, page_url_sort_key, id)',
	'CREATE INDEX av_validator_url ON analysis_violations(validator, page_url_sort_key, id)',
	'CREATE INDEX av_severity_url ON analysis_violations(severity, page_url_sort_key, id)',
	'CREATE INDEX av_rule_url ON analysis_violations(rule, page_url_sort_key, id)',
	'CREATE INDEX av_message_order ON analysis_violations(message_sort_key, id)',
	'CREATE INDEX av_code_order ON analysis_violations(code_sort_key, id)',
	'CREATE INDEX av_page ON analysis_violations(page_id, id)',
] as const;

/**
 * Rewrites a freshly crawled `.nitpicker` file into the shape an
 * earlier-version archive has: adds the legacy `analysis_text_refs` /
 * `analysis_violations` tables and one violation row per internal page
 * (`content_items.is_external = 0`), then writes the archive back.
 *
 * The fixture is generated at test time because an archive's page URLs embed
 * the test server's dynamically assigned port, so a committed fixture could
 * not be re-crawled (`--recrawl` / `--retry-failed`).
 * @param filePath - Absolute path to the `.nitpicker` archive to rewrite.
 * @param cwd - Working directory used for the temporary extraction.
 * @returns The number of violation rows inserted.
 * @example
 * const inserted = await injectLegacyAnalysisTables(filePath, cwd);
 * // `analysis_violations` now holds `inserted` rows referencing content_items.
 */
export async function injectLegacyAnalysisTables(
	filePath: string,
	cwd: string,
): Promise<number> {
	const archive = await Archive.open({ filePath, cwd, openPluginData: true });
	try {
		const knex = archive.getKnex();
		for (const ddl of LEGACY_ANALYSIS_DDL) {
			await knex.raw(ddl);
		}
		await knex('analysis_text_refs').insert({
			id: 1,
			text: 'legacy finding',
			sha256: 'legacy-finding-sha256',
		});
		const pages: { id: number; url: string }[] = await knex
			.select('content_items.id as id', 'url_refs.url as url')
			.from('content_items')
			.join('url_refs', 'url_refs.id', 'content_items.url_id')
			.where('content_items.is_external', 0);
		for (const page of pages) {
			await knex('analysis_violations').insert({
				page_id: page.id,
				validator: 'markuplint',
				severity: 'warning',
				rule: 'legacy-rule',
				message_text_id: 1,
				page_url_sort_key: page.url,
				message_sort_key: 'legacy finding',
				code_sort_key: '',
				line: 1,
				col: 1,
			});
		}
		await archive.write();
		return pages.length;
	} finally {
		await archive.close();
	}
}
