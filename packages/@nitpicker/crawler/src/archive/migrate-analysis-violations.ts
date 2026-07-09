import type { Knex } from 'knex';

/**
 * Adds the analysis-violation tables to archives created before #116.
 *
 * The regular init schema creates these tables for new archives. This
 * migration only upgrades existing archives that already have `pages` and
 * are writable. It is intentionally idempotent and silent.
 * @param instance - The Knex query builder instance connected to the database.
 */
export async function migrateAnalysisViolations(instance: Knex): Promise<void> {
	const hasTable = await instance.schema.hasTable('analysis_violations');
	if (hasTable) {
		return;
	}
	const hasPages = await instance.schema.hasTable('pages');
	if (!hasPages) {
		return;
	}

	await instance.schema.createTable('analysis_text_refs', (t) => {
		t.increments('id');
		t.text('text').notNullable();
		t.string('sha256', 64).notNullable();
		t.unique(['sha256', 'text']);
	});
	await instance.schema.createTable('analysis_violations', (t) => {
		t.increments('id');
		t.integer('page_id').notNullable().unsigned().references('pages.id');
		t.string('validator').notNullable();
		t.string('severity').notNullable();
		t.string('rule').notNullable();
		t.integer('message_text_id')
			.notNullable()
			.unsigned()
			.references('analysis_text_refs.id');
		t.integer('code_text_id').unsigned().references('analysis_text_refs.id');
		t.text('page_url_sort_key').notNullable();
		t.text('message_sort_key').notNullable();
		t.text('code_sort_key').notNullable();
	});
	await instance.raw(
		'CREATE INDEX av_url_order ON analysis_violations(page_url_sort_key, id)',
	);
	await instance.raw(
		'CREATE INDEX av_filter_url ON analysis_violations(validator, severity, rule, page_url_sort_key, id)',
	);
	await instance.raw(
		'CREATE INDEX av_validator_url ON analysis_violations(validator, page_url_sort_key, id)',
	);
	await instance.raw(
		'CREATE INDEX av_severity_url ON analysis_violations(severity, page_url_sort_key, id)',
	);
	await instance.raw(
		'CREATE INDEX av_rule_url ON analysis_violations(rule, page_url_sort_key, id)',
	);
	await instance.raw(
		'CREATE INDEX av_message_order ON analysis_violations(message_sort_key, id)',
	);
	await instance.raw(
		'CREATE INDEX av_code_order ON analysis_violations(code_sort_key, id)',
	);
	await instance.raw('CREATE INDEX av_page ON analysis_violations(page_id, id)');
}
