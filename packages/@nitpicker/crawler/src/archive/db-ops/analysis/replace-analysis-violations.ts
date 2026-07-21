import type { Knex } from 'knex';

import { createHash } from 'node:crypto';

import { eachSplitted } from '../../../utils/array/each-splitted.js';

/**
 * Matches the position suffix that `@nitpicker/analyze-markuplint` and
 * `@nitpicker/analyze-textlint` used to append to `Violation.url` before
 * issue #225 (e.g. `https://example.com/page (5:10)`). Anchored to the end
 * of the string so a URL that legitimately contains a similar-looking
 * substring earlier on is not mistaken for the suffix.
 */
const LEGACY_CORRUPTED_URL_PATTERN = /^(.+) \((\d+):(\d+)\)$/;

/**
 * Splits a legacy corrupted `Violation.url` (page URL + trailing
 * `" (line:col)"`) back into a clean URL and its position, or returns
 * `null` when `url` does not match the corrupted shape (e.g. a clean axe
 * URL, or a URL that already carries explicit `line`/`col`).
 * @param url - The `Violation.url` value as read from storage or input.
 * @returns The recovered `{ url, line, col }`, or `null` when `url` is not corrupted.
 */
function parseLegacyCorruptedUrl(
	url: string,
): { url: string; line: number; col: number } | null {
	const match = LEGACY_CORRUPTED_URL_PATTERN.exec(url);
	if (!match) {
		return null;
	}
	const [, cleanUrl, line, col] = match;
	return { url: cleanUrl!, line: Number(line), col: Number(col) };
}

/**
 * Adds the `line`/`col` columns to `analysis_violations` when they are
 * missing, i.e. when the archive's table was provisioned before issue #225.
 *
 * `create-adjunct-tables.ts` never mutates a table it finds already
 * present — catching up an *existing* table normally requires a
 * version-gated migration script (see `scripts/migrate-to-0.13.mjs`). This
 * function relies on the exception documented in ARCHITECTURE.md's
 * invariants list: a nullable, additive column on a table with a single
 * write path may self-heal here without a version bump, because
 * `replaceAnalysisViolations` is that single write path for
 * `analysis_violations`. Runs before the transaction below so the DDL is
 * not mixed with the DML rewrite.
 * @param knex - Knex query builder connected to the archive DB.
 */
async function ensureLineColColumns(knex: Knex): Promise<void> {
	if (!(await knex.schema.hasColumn('analysis_violations', 'line'))) {
		await knex.schema.alterTable('analysis_violations', (table) => {
			table.integer('line').nullable();
		});
	}
	if (!(await knex.schema.hasColumn('analysis_violations', 'col'))) {
		await knex.schema.alterTable('analysis_violations', (table) => {
			table.integer('col').nullable();
		});
	}
}

/**
 * Replaces the stored analysis violations with a freshly generated set.
 *
 * The function resolves every violation URL to a `content_items.id` (via
 * the `url_refs` dictionary), deduplicates message/code text through
 * `analysis_text_refs`, and rewrites `analysis_violations` in one
 * transaction. This is the storage-side counterpart of the query-layer
 * `getViolations` read path.
 *
 * Violations whose `url` still carries the pre-#225 corrupted position
 * suffix (and that do not already carry explicit `line`/`col`) are repaired
 * in place: {@link parseLegacyCorruptedUrl} splits the suffix off before URL
 * resolution, so both freshly-analyzed and legacy-JSON-backfilled data end
 * up in the same clean shape.
 * @param knex - Knex query builder connected to the archive DB.
 * @param violations - Flat violation list from the analyze phase.
 */
export async function replaceAnalysisViolations(
	knex: Knex,
	violations: readonly {
		validator: string;
		severity: string;
		rule: string;
		code?: string | null;
		message: string;
		url: string;
		line?: number | null;
		col?: number | null;
	}[],
): Promise<void> {
	await ensureLineColColumns(knex);
	const repaired = violations.map((violation) => {
		if (violation.line != null || violation.col != null) {
			return violation;
		}
		const parsed = parseLegacyCorruptedUrl(violation.url);
		return parsed
			? { ...violation, url: parsed.url, line: parsed.line, col: parsed.col }
			: violation;
	});
	await knex.transaction(async (trx) => {
		await trx('analysis_violations').delete();
		await trx('analysis_text_refs').delete();
		if (repaired.length === 0) {
			return;
		}

		const urls = [...new Set(repaired.map((v) => v.url))];
		const pageIdByUrl = new Map<string, number>();
		await eachSplitted(urls, 500, async (chunk) => {
			const pageRows = await trx('content_items')
				.join('url_refs', 'url_refs.id', 'content_items.url_id')
				.select('content_items.id as id', 'url_refs.url as url')
				.whereIn('url_refs.url', chunk);
			for (const row of pageRows) {
				pageIdByUrl.set(row.url, row.id);
			}
		});
		if (pageIdByUrl.size !== urls.length) {
			const missing = urls.filter((url) => !pageIdByUrl.has(url));
			throw new Error(
				`replaceAnalysisViolations: could not resolve ${missing.length} page URL(s): ${missing[0]}`,
			);
		}

		const textByValue = new Map<string, number>();
		const resolveTextId = async (text: string): Promise<number> => {
			const cached = textByValue.get(text);
			if (cached != null) {
				return cached;
			}
			const sha256 = createHash('sha256').update(text).digest('hex');
			await trx('analysis_text_refs')
				.insert({ text, sha256 })
				.onConflict(['sha256', 'text'])
				.ignore();
			const [existing] = await trx
				.select('id')
				.from<{ id: number }>('analysis_text_refs')
				.where('sha256', sha256)
				.where('text', text);
			if (!existing) {
				throw new Error(
					`replaceAnalysisViolations: failed to resolve text ref for ${text}`,
				);
			}
			textByValue.set(text, existing.id);
			return existing.id;
		};

		const rows: Array<{
			page_id: number;
			validator: string;
			severity: string;
			rule: string;
			message_text_id: number;
			code_text_id: number | null;
			page_url_sort_key: string;
			message_sort_key: string;
			code_sort_key: string;
			line: number | null;
			col: number | null;
		}> = [];
		for (const violation of repaired) {
			const pageId = pageIdByUrl.get(violation.url);
			if (!pageId) {
				throw new Error(
					`replaceAnalysisViolations: could not resolve page URL: ${violation.url}`,
				);
			}
			const messageTextId = await resolveTextId(violation.message);
			const codeValue = violation.code ?? '';
			const codeTextId = codeValue === '' ? null : await resolveTextId(codeValue);
			rows.push({
				page_id: pageId,
				validator: violation.validator,
				severity: violation.severity,
				rule: violation.rule,
				message_text_id: messageTextId,
				line: violation.line ?? null,
				col: violation.col ?? null,
				code_text_id: codeTextId,
				page_url_sort_key: violation.url,
				message_sort_key: violation.message,
				code_sort_key: codeValue,
			});
		}

		await eachSplitted(rows, 500, async (chunk) => {
			await trx('analysis_violations').insert(chunk);
		});
	});
}
