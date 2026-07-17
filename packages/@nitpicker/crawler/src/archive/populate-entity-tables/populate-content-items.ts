import type { Knex } from 'knex';

import { loadContentTypeRefs } from './resolve-content-type-refs.js';
import { resolveHeaderSets } from './resolve-header-sets.js';
import { resolveUrlRefs } from './resolve-url-refs.js';

/**
 * Rows scanned per keyset-paginated `SELECT` chunk against `pages`. The
 * migration reads every page column that maps to `content_items` in one
 * SELECT per chunk, so scaling this too high would blow up the result-set
 * size for long meta text columns. 500 keeps peak memory bounded at
 * ≈ 30 MB for a chunk of `pages` with populated meta and header sets.
 */
const READ_CHUNK_SIZE = 500;

/**
 * Rows sent per `INSERT INTO content_items ... VALUES (...)` statement.
 * Each row binds 16 params (id + 15 core columns), so 300 rows =
 * 4 800 params — safely under SQLite's default variable limit of 32 766.
 */
const INSERT_CHUNK_SIZE = 300;

/**
 * Populates `content_items` from `pages` (issue #193).
 *
 * Strategy per chunk:
 *
 * 1. **Keyset-paginate** `pages` in id order so partial-failure re-runs
 *    resume from the last committed row without reading the full table.
 *    Same pattern as {@link ../populate-ref-tables/populate-url-refs.ts}.
 * 2. **Batch-resolve** `url_refs.id`, `content_type_refs.id`, and
 *    `header_sets.id` for every distinct value in the chunk — one round
 *    trip per ref table instead of N round trips per row.
 * 3. **Bulk INSERT** with explicit `id = pages.id`. Reusing the legacy
 *    PK preserves every FK reference in `page_errors` / `page_tags` /
 *    `page_jsonld` / `page_html_ref` without a per-row UPDATE.
 *
 * `redirect_dest_id` is copied verbatim from `redirectDestId` — the FK
 * self-reference is `DEFERRABLE INITIALLY DEFERRED` (see
 * {@link ../create-entity-tables.ts}) so a redirect source
 * inserted before its destination is validated only at COMMIT time.
 *
 * `INSERT OR IGNORE` on the natural PK makes the step idempotent — a
 * re-run after a partial failure only inserts the rows that are still
 * missing.
 *
 * `content_type_refs` is preloaded once at the start because its
 * cardinality is small (see {@link ./resolve-content-type-refs.ts}); the
 * URL and header-set resolvers are called per chunk because their
 * per-archive cardinality can be very large (one row per distinct URL /
 * response JSON).
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @example
 * await knex.transaction(async (trx) => {
 *   await populateContentItems(trx);
 * });
 */
export async function populateContentItems(trx: Knex): Promise<void> {
	const contentTypeIds = await loadContentTypeRefs(trx);
	let cursor = 0;
	while (true) {
		const rows: PageRow[] = await trx('pages')
			.select(
				'id',
				'url',
				'redirectDestId',
				'scraped',
				'isTarget',
				'isExternal',
				'status',
				'statusText',
				'contentType',
				'contentLength',
				'responseHeaders',
				'firstCrawledAt',
				'lastCrawledAt',
				'order',
				'isSkipped',
				'skipReason',
				'source',
			)
			.where('id', '>', cursor)
			.orderBy('id', 'asc')
			.limit(READ_CHUNK_SIZE);
		if (rows.length === 0) {
			break;
		}
		cursor = rows.at(-1)!.id;

		const urls = new Set<string>();
		const headerJsonStrings = new Set<string>();
		for (const row of rows) {
			urls.add(row.url);
			if (typeof row.responseHeaders === 'string' && row.responseHeaders !== '') {
				headerJsonStrings.add(row.responseHeaders);
			}
		}
		const urlIds = await resolveUrlRefs(trx, urls);
		const headerSetIds = await resolveHeaderSets(trx, headerJsonStrings);

		const inserts = rows.map((row) => {
			const urlId = urlIds.get(row.url) ?? null;
			if (urlId === null) {
				throw new Error(
					`populateContentItems: url_refs.id not resolved for page id=${row.id} url=${row.url} — populateUrlRefs must run first`,
				);
			}
			let contentTypeId: number | null = null;
			if (row.contentType != null && row.contentType !== '') {
				const resolved = contentTypeIds.get(row.contentType);
				if (resolved === undefined) {
					throw new Error(
						`populateContentItems: content_type_refs.id not resolved for page id=${row.id} contentType=${row.contentType} — populateContentTypeRefs must run first`,
					);
				}
				contentTypeId = resolved;
			}
			let headerSetId: number | null = null;
			if (typeof row.responseHeaders === 'string' && row.responseHeaders !== '') {
				const resolved = headerSetIds.get(row.responseHeaders);
				if (resolved === undefined) {
					// `resolveHeaderSets` skips sentinel values ('{}' / 'null')
					// AND payloads that `decomposeHeaderSet` cannot parse into
					// any entries — in both cases the source row genuinely had
					// no header set to point at, so `header_set_id = null` is
					// the correct final state. `resolveHeaderSets` already ran
					// the raw_hash fallback, so this branch only fires when the
					// row has no persistable header set (parse error, or every
					// entry stripped for non-string values).
					headerSetId = null;
				} else {
					headerSetId = resolved;
				}
			}
			return {
				id: row.id,
				url_id: urlId,
				is_external: row.isExternal == null ? 0 : row.isExternal ? 1 : 0,
				scraped: row.scraped ? 1 : 0,
				is_target: row.isTarget ? 1 : 0,
				status: row.status ?? null,
				status_text: row.statusText ?? null,
				content_type_id: contentTypeId,
				content_length: row.contentLength ?? null,
				header_set_id: headerSetId,
				redirect_dest_id: row.redirectDestId ?? null,
				source: row.source,
				first_crawled_at: row.firstCrawledAt ?? null,
				last_crawled_at: row.lastCrawledAt ?? null,
				crawl_order: row.order ?? null,
				is_skipped: row.isSkipped == null ? null : row.isSkipped ? 1 : 0,
				skip_reason: row.skipReason ?? null,
			};
		});

		for (let index = 0; index < inserts.length; index += INSERT_CHUNK_SIZE) {
			const chunk = inserts.slice(index, index + INSERT_CHUNK_SIZE);
			await trx('content_items').insert(chunk).onConflict('id').ignore();
		}
	}
}

/**
 * Shape of one row read from the legacy `pages` table by
 * {@link populateContentItems}. Every column mapped to `content_items`
 * or used to decide ref lookups is declared here — meta-only columns
 * (title / description / etc.) live in a separate SELECT run by
 * {@link ./populate-page-meta.ts}.
 */
interface PageRow {
	/** Legacy `pages.id`, reused verbatim as `content_items.id`. */
	id: number;
	/** Legacy `pages.url` — resolved to `content_items.url_id` via `url_refs`. */
	url: string;
	/** Legacy `pages.redirectDestId` — copied to `content_items.redirect_dest_id`. */
	redirectDestId: number | null;
	/** Legacy `pages.scraped` — copied to `content_items.scraped`. */
	scraped: boolean | number;
	/** Legacy `pages.isTarget` — copied to `content_items.is_target`. */
	isTarget: boolean | number;
	/** Legacy `pages.isExternal` — copied to `content_items.is_external`. */
	isExternal: boolean | number | null;
	/** Legacy `pages.status` — copied verbatim. */
	status: number | null;
	/** Legacy `pages.statusText` — copied verbatim. */
	statusText: string | null;
	/** Legacy `pages.contentType` — resolved to `content_type_id` via `content_type_refs`. */
	contentType: string | null;
	/** Legacy `pages.contentLength` — copied verbatim. */
	contentLength: number | null;
	/** Legacy `pages.responseHeaders` — resolved to `header_set_id` via `header_sets.raw_json_hash`. */
	responseHeaders: string | null;
	/** Legacy `pages.firstCrawledAt` — copied to `content_items.first_crawled_at`. */
	firstCrawledAt: number | null;
	/** Legacy `pages.lastCrawledAt` — copied to `content_items.last_crawled_at`. */
	lastCrawledAt: number | null;
	/** Legacy `pages.order` — copied to `content_items.crawl_order`. */
	order: number | null;
	/** Legacy `pages.isSkipped` — copied to `content_items.is_skipped`. */
	isSkipped: boolean | number | null;
	/** Legacy `pages.skipReason` — copied to `content_items.skip_reason`. */
	skipReason: string | null;
	/** Legacy `pages.source` — copied verbatim to `content_items.source`. */
	source: string;
}
