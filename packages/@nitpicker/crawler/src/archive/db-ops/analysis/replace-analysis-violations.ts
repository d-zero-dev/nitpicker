import type { Knex } from 'knex';

import { createHash } from 'node:crypto';

import { eachSplitted } from '../../../utils/array/each-splitted.js';

/**
 * Replaces the stored analysis violations with a freshly generated set.
 *
 * The function resolves every violation URL to a `content_items.id` (via
 * the `url_refs` dictionary), deduplicates message/code text through
 * `analysis_text_refs`, and rewrites `analysis_violations` in one
 * transaction. This is the storage-side counterpart of the query-layer
 * `getViolations` read path.
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
	}[],
): Promise<void> {
	await knex.transaction(async (trx) => {
		await trx('analysis_violations').delete();
		await trx('analysis_text_refs').delete();
		if (violations.length === 0) {
			return;
		}

		const urls = [...new Set(violations.map((v) => v.url))];
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
		}> = [];
		for (const violation of violations) {
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
