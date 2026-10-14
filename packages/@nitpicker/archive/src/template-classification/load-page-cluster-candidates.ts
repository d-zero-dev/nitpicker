import type { LoadPageClusterCandidatesOptions, PageClusterCandidate } from './types.js';
import type Archive from '../archive.js';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';

import { parseMainContentClassList } from '../meta/parse-main-content-class-list.js';

import { createContentRootHint } from './create-content-root-hint.js';

/**
 * Rows read per query. Each batch's rows are turned into candidates and
 * dropped before the next is read, so this bounds the transient garbage of
 * one query, not what stays resident.
 */
const DEFAULT_BATCH_SIZE = 10_000;

interface CandidateRow {
	id: number;
	url: string;
	main_content_node_name: string | null;
	main_content_id: string | null;
	main_content_role: string | null;
	main_content_class_list: string | null;
}

/**
 * Loads the internal HTML pages of the archive that have a stored HTML
 * snapshot as {@link PageClusterCandidate}s: each page's id and the signals
 * template classification reads without HTML, and nothing else.
 *
 * It reads only the page's id, its url and the four `main_content_*` columns
 * the content-root hint is built from, straight from `content_items` /
 * `page_meta`, in `content_items.id` order, one keyset batch at a time, and
 * keeps a page only when its id is in `pageIdsWithHtml`. It deliberately
 * builds no `Page`: a `Page` carries the page's whole row (every meta column,
 * joined from many meta tables), which is far more than classification reads and
 * would stay resident for every page until the clustering ends.
 *
 * "Internal HTML page" is `Page.isInternalPage()` evaluated in SQL — content
 * type `text/html` and not external, the same selection as `getPages`'
 * `'internal-page'` filter (`load-page-cluster-candidates.spec.ts` asserts
 * the two return the same pages). The URL is parsed as
 * `Page.url` does with queries kept (`disableQueries: false`).
 * @param archive - The archive to read from.
 * @param options - See {@link LoadPageClusterCandidatesOptions}.
 * @returns The candidates, in `content_items.id` order.
 * @throws {Error} When a stored URL cannot be parsed, or a stored
 *   `main_content_class_list` is not a JSON array of strings.
 * @example
 * ```ts
 * const pageIdsWithHtml = await collectPageIdsWithHtml(archive);
 * const candidates = await loadPageClusterCandidates(archive, { pageIdsWithHtml });
 * ```
 */
export async function loadPageClusterCandidates(
	archive: Archive,
	options: LoadPageClusterCandidatesOptions,
): Promise<PageClusterCandidate[]> {
	const { pageIdsWithHtml, onProgress, batchSize = DEFAULT_BATCH_SIZE } = options;
	const knex = archive.getKnex();
	const internalHtml = () =>
		knex('content_items as ci')
			.join('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
			.where('ctr.raw', 'text/html')
			.andWhere('ci.is_external', 0);

	// Only for progress: counted once up front. The archive is not written
	// while it is classified, so `done` ends at `total`.
	const countRow = (await internalHtml().count({ count: '*' }).first()) as
		| { count: number | string }
		| undefined;
	const total = Number(countRow?.count ?? 0);

	const candidates: PageClusterCandidate[] = [];
	let lastId = 0;
	let done = 0;

	while (true) {
		const rows = (await internalHtml()
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.leftJoin('page_meta as pm', 'pm.page_id', 'ci.id')
			.andWhere('ci.id', '>', lastId)
			.orderBy('ci.id')
			.limit(batchSize)
			.select(
				'ci.id as id',
				'ur.url as url',
				'pm.main_content_node_name as main_content_node_name',
				'pm.main_content_id as main_content_id',
				'pm.main_content_role as main_content_role',
				'pm.main_content_class_list as main_content_class_list',
			)) as CandidateRow[];
		if (rows.length === 0) {
			break;
		}

		for (const row of rows) {
			if (!pageIdsWithHtml.has(row.id)) {
				continue;
			}
			const url = parseUrl(row.url, { disableQueries: false });
			if (!url) {
				throw new Error(
					`loadPageClusterCandidates: cannot parse the stored URL ${row.url}`,
				);
			}
			const contentRoot = createContentRootHint({
				mainContentNodeName: row.main_content_node_name,
				mainContentId: row.main_content_id,
				mainContentRole: row.main_content_role,
				mainContentClassList: parseMainContentClassList(row.main_content_class_list),
			});
			candidates.push({
				id: row.id,
				href: url.href,
				paths: url.paths,
				host: url.port ? `${url.hostname}:${url.port}` : url.hostname,
				// Left off entirely (not `undefined`) for pages with no detected
				// main content, so the candidate carries no undefined-valued key.
				...(contentRoot ? { contentRoot } : {}),
			});
		}

		lastId = rows.at(-1)!.id;
		done += rows.length;
		onProgress?.({ phase: 'loading-pages', done, total });
	}

	return candidates;
}
