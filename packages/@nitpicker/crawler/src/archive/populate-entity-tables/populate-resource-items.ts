import type { Knex } from 'knex';

import { loadContentTypeRefs } from './resolve-content-type-refs.js';
import { resolveHeaderSets } from './resolve-header-sets.js';
import { resolveUrlRefs } from './resolve-url-refs.js';

/**
 * Rows scanned per keyset-paginated `SELECT` chunk against `resources`.
 * `resources` rows are narrow (no meta columns) so 800 rows fits
 * comfortably in a chunk without stressing memory. Bumping this higher
 * would help throughput but risks pushing large `responseHeaders` JSON
 * blobs past a healthy per-result-set size on archives with per-row
 * multi-KB header payloads.
 */
const READ_CHUNK_SIZE = 800;

/**
 * Rows sent per `INSERT INTO resource_items ... VALUES (...)` statement.
 * Each row binds 11 params (id + 10 columns), so 500 rows = 5 500 params
 * — well under SQLite's default variable limit.
 */
const INSERT_CHUNK_SIZE = 500;

/**
 * Populates `resource_items` from `resources` (issue #193 step 6-D-3).
 *
 * Structurally analogous to {@link ./populate-content-items.ts}: for each
 * `resources` chunk, batch-resolve `url_refs.id`, `content_type_refs.id`,
 * and `header_sets.id`, then bulk-INSERT with explicit `id = resources.id`.
 * Reusing the legacy PK preserves the `resources-referrers.resourceId`
 * FK reference (which becomes `resource_ref_edges.resource_id` in Phase
 * 6-D-5) without any per-row UPDATE.
 *
 * `INSERT OR IGNORE` on `id` makes the step idempotent.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @example
 * await knex.transaction(async (trx) => {
 *   await populateResourceItems(trx);
 * });
 */
export async function populateResourceItems(trx: Knex): Promise<void> {
	const contentTypeIds = await loadContentTypeRefs(trx);
	let cursor = 0;
	while (true) {
		const rows: ResourceRow[] = await trx('resources')
			.select(
				'id',
				'url',
				'isExternal',
				'status',
				'statusText',
				'contentType',
				'contentLength',
				'responseHeaders',
				'compress',
				'cdn',
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
					`populateResourceItems: url_refs.id not resolved for resource id=${row.id} url=${row.url} — 0.13-1 populate must run first`,
				);
			}
			let contentTypeId: number | null = null;
			if (row.contentType != null && row.contentType !== '') {
				const resolved = contentTypeIds.get(row.contentType);
				if (resolved === undefined) {
					throw new Error(
						`populateResourceItems: content_type_refs.id not resolved for resource id=${row.id} contentType=${row.contentType} — 0.13-0 populate must run first`,
					);
				}
				contentTypeId = resolved;
			}
			const headerSetId =
				typeof row.responseHeaders === 'string' && row.responseHeaders !== ''
					? (headerSetIds.get(row.responseHeaders) ?? null)
					: null;
			return {
				id: row.id,
				url_id: urlId,
				is_external: row.isExternal == null ? 0 : row.isExternal ? 1 : 0,
				status: row.status ?? null,
				status_text: row.statusText ?? null,
				content_type_id: contentTypeId,
				content_length: row.contentLength ?? null,
				header_set_id: headerSetId,
				compress: row.compress ?? null,
				cdn: row.cdn ?? null,
				source: row.source,
			};
		});

		for (let index = 0; index < inserts.length; index += INSERT_CHUNK_SIZE) {
			const chunk = inserts.slice(index, index + INSERT_CHUNK_SIZE);
			await trx('resource_items').insert(chunk).onConflict('id').ignore();
		}
	}
}

/**
 * Shape of one row read from the legacy `resources` table by
 * {@link populateResourceItems}. Restricted to the columns that map to
 * `resource_items` — resources have no meta split.
 */
interface ResourceRow {
	/** Legacy `resources.id`, reused verbatim as `resource_items.id`. */
	id: number;
	/** Legacy `resources.url` — resolved to `resource_items.url_id`. */
	url: string;
	/** Legacy `resources.isExternal` — copied to `resource_items.is_external`. */
	isExternal: boolean | number | null;
	/** Legacy `resources.status` — copied verbatim. */
	status: number | null;
	/** Legacy `resources.statusText` — copied verbatim. */
	statusText: string | null;
	/** Legacy `resources.contentType` — resolved via `content_type_refs`. */
	contentType: string | null;
	/** Legacy `resources.contentLength` — copied verbatim. */
	contentLength: number | null;
	/** Legacy `resources.responseHeaders` — resolved via `header_sets.raw_json_hash`. */
	responseHeaders: string | null;
	/** Legacy `resources.compress` — copied verbatim. */
	compress: string | null;
	/** Legacy `resources.cdn` — copied verbatim. */
	cdn: string | null;
	/** Legacy `resources.source` — copied verbatim. */
	source: string;
}
