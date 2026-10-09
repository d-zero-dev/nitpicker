import type { ReplacePageTemplatesParams, TemplateLabel } from './types.js';
import type { Knex } from 'knex';

import { eachSplitted } from '../../../utils/array/each-splitted.js';
import { compressPayload } from '../_shared/compress-payload.js';

import { assignTemplateLabels } from './assign-template-labels.js';

/**
 * Replaces the stored DOM-structure template classification with a freshly
 * generated set.
 *
 * Every classified page is a full-archive, all-or-nothing recomputation
 * (see `classifyPageTemplates`), so this always deletes
 * every existing row before inserting the new set — there is no per-page
 * incremental update path. A page whose URL can't be
 * resolved back to a `content_items` row is silently skipped rather than
 * treated as a hard failure: losing one page's template classification
 * (e.g. a URL-normalization mismatch between the in-memory `Page.url.href`
 * and the stored `url_refs.url`) should not discard the rest of a
 * potentially multi-thousand-page classification run.
 *
 * `page_template_clusters` is always cleared alongside `page_templates`
 * regardless of whether `clusterReasonsByTemplateKey` is passed — "no
 * reason" must mean "not captured for this run", never "carry over the
 * previous run's reason". Reason rows are inserted for every key in
 * `clusterReasonsByTemplateKey` even if some have no surviving member page
 * in `templateKeysByUrl` after URL-resolution skips above — harmless
 * (nothing joins `page_template_clusters` back to `page_templates` by FK;
 * see the table's own JSDoc), and simpler than cross-filtering the two maps.
 *
 * `page_template_labels` is the one table that is **not** wholesale
 * replaced: the human-facing label of each new cluster is carried forward
 * from whichever previous cluster it shares most pages with
 * (`assignTemplateLabels`), which is what lets "events template B" keep
 * meaning the same template across re-runs, and the rows of clusters that
 * disappeared are kept as *retired* labels so their letters are never
 * re-issued to a different template on a later run (only the rows for the
 * keys being written, and the old row of a label that moved to a new key,
 * are removed). Readers look labels up by the keys
 * currently in `page_templates`, so retired rows are invisible to them.
 * The previous `page_templates` and `page_template_labels` rows are read
 * inside the same transaction that writes — there is no window in which
 * another writer could change what the labels were derived from. An empty
 * `templateKeysByUrl` therefore clears the classification but leaves every
 * label row in place.
 * @param knex - Knex query builder connected to the archive DB.
 * @param params - See {@link ReplacePageTemplatesParams}.
 */
export async function replacePageTemplates(
	knex: Knex,
	params: ReplacePageTemplatesParams,
): Promise<void> {
	const { templateKeysByUrl, clusterReasonsByTemplateKey } = params;

	// Compressing every reason is pure CPU work independent of the DB — done
	// before opening the transaction below so it doesn't extend how long the
	// SQLite write-lock is held for.
	const reasonRows =
		clusterReasonsByTemplateKey && clusterReasonsByTemplateKey.size > 0
			? [...clusterReasonsByTemplateKey].map(([templateKey, reason]) => {
					const { body, codec, sizeRaw, sizeStored } = compressPayload(
						Buffer.from(JSON.stringify(reason), 'utf8'),
					);
					return {
						template_key: templateKey,
						member_count: reason.memberCount,
						reason_json: body,
						codec,
						size_raw: sizeRaw,
						size_stored: sizeStored,
					};
				})
			: [];

	await knex.transaction(async (trx) => {
		// Resolve the new membership and read the previous one *before* the
		// deletes below — label inheritance needs both sides.
		const urls = [...templateKeysByUrl.keys()];
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

		const rows: Array<{ page_id: number; template_key: string }> = [];
		const clusters = new Map<string, { pageIds: number[]; urls: string[] }>();
		for (const [url, templateKey] of templateKeysByUrl) {
			const pageId = pageIdByUrl.get(url);
			if (pageId == null) {
				continue;
			}
			rows.push({ page_id: pageId, template_key: templateKey });
			let cluster = clusters.get(templateKey);
			if (!cluster) {
				cluster = { pageIds: [], urls: [] };
				clusters.set(templateKey, cluster);
			}
			cluster.pageIds.push(pageId);
			cluster.urls.push(url);
		}

		const previousLabels = await loadPreviousLabels(trx);
		const labels = assignTemplateLabels({
			clusters,
			previousMembership: await loadPreviousMembership(trx),
			previousLabels,
		});

		// Rows to drop: the keys being (re)written, plus previous keys whose
		// label was inherited by a new key — the label moved, so its old row
		// would otherwise linger as a duplicate of the same name.
		const writtenPairs = new Set([...labels.values()].map(labelPair));
		const staleKeys = [...labels.keys()];
		for (const [previousKey, label] of previousLabels) {
			if (!labels.has(previousKey) && writtenPairs.has(labelPair(label))) {
				staleKeys.push(previousKey);
			}
		}

		await trx('page_templates').delete();
		await trx('page_template_clusters').delete();
		await eachSplitted(staleKeys, 500, async (chunk) => {
			await trx('page_template_labels').whereIn('template_key', chunk).delete();
		});

		if (reasonRows.length > 0) {
			await eachSplitted(reasonRows, 100, async (chunk) => {
				await trx('page_template_clusters').insert(chunk);
			});
		}

		if (rows.length === 0) {
			return;
		}

		await eachSplitted(rows, 500, async (chunk) => {
			await trx('page_templates').insert(chunk);
		});

		const labelRows = [...labels].map(([templateKey, label]) => ({
			template_key: templateKey,
			section: label.section,
			ordinal: label.ordinal,
		}));
		await eachSplitted(labelRows, 500, async (chunk) => {
			await trx('page_template_labels').insert(chunk);
		});
	});
}

/**
 * The identity of a label as a name: its `(section, ordinal)` pair.
 * @param label - The label.
 * @returns A string key unique per name.
 */
function labelPair(label: TemplateLabel): string {
	return `${label.section ?? '\0'}:${label.ordinal}`;
}

/**
 * Reads the previous run's `page_templates` rows as template key → page ids.
 * @param trx - The replacing transaction.
 * @returns The previous membership; empty on a first run.
 */
async function loadPreviousMembership(trx: Knex): Promise<Map<string, number[]>> {
	const previousRows = (await trx('page_templates').select(
		'page_id as pageId',
		'template_key as templateKey',
	)) as { pageId: number; templateKey: string }[];
	const membership = new Map<string, number[]>();
	for (const row of previousRows) {
		const pageIds = membership.get(row.templateKey);
		if (pageIds) {
			pageIds.push(row.pageId);
		} else {
			membership.set(row.templateKey, [row.pageId]);
		}
	}
	return membership;
}

/**
 * Reads the previous run's `page_template_labels` rows.
 * @param trx - The replacing transaction.
 * @returns Template key → label; empty on a first run.
 */
async function loadPreviousLabels(trx: Knex): Promise<Map<string, TemplateLabel>> {
	const labelRows = (await trx('page_template_labels').select(
		'template_key as templateKey',
		'section',
		'ordinal',
	)) as { templateKey: string; section: string | null; ordinal: number }[];
	return new Map(
		labelRows.map((row) => [
			row.templateKey,
			{ section: row.section, ordinal: row.ordinal },
		]),
	);
}
