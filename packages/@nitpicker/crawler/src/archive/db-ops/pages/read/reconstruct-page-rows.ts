import type { DB_Page } from '../../../types.js';
import type { Knex } from 'knex';

import { decodeJsonRef } from '../../_shared/decode-json-ref.js';
import { loadResponseHeadersBySetIds } from '../../_shared/load-response-headers-by-set-ids.js';

/**
 * Raw row shape produced by {@link ../read/build-page-query.js} before
 * `responseHeaders` / `meta_extras` reconstruction.
 */
interface RawPageRow extends Omit<
	DB_Page,
	'responseHeaders' | 'meta_extras' | 'networkLogs'
> {
	/** `content_items.header_set_id`, or null when no headers were recorded. */
	headerSetId: number | null;
	/** `json_refs.json_text` for `meta_extras`, or null when absent. */
	extras_body: Buffer | string | null;
	/** `json_refs.codec` for `meta_extras` (`'zstd'` or `'none'`), or null when absent. */
	extras_codec: 'zstd' | 'none' | null;
}

/**
 * Reconstructs `responseHeaders` (JSON string) and `meta_extras` (JSON
 * string) for a batch of raw page rows. Headers load through
 * {@link ../../_shared/load-response-headers-by-set-ids.js} (chunked
 * batch lookup, never N+1); `meta_extras` decodes through
 * {@link ../../_shared/decode-json-ref.js}. `networkLogs` has no 0.13
 * equivalent (it is a legacy-only field nothing ever wrote past the
 * pre-0.13 write path either) and is always `null`.
 * @param knex - Knex query builder connected to the archive DB.
 * @param rows - Raw rows from {@link ../read/build-page-query.js}.
 * @returns Fully reconstructed `DB_Page` rows, in the same order as `rows`.
 * @example
 * const raw = await buildPageQuery(knex).where('ci.is_target', 1);
 * const pages = await reconstructPageRows(knex, raw);
 */
export async function reconstructPageRows(
	knex: Knex,
	rows: readonly RawPageRow[],
): Promise<DB_Page[]> {
	const headerSetIds = [
		...new Set(rows.map((r) => r.headerSetId).filter((id) => id != null)),
	];
	const headersBySetId = await loadResponseHeadersBySetIds(knex, headerSetIds);

	return rows.map((row) => {
		const { headerSetId, extras_body, extras_codec, ...rest } = row;
		return {
			...rest,
			responseHeaders: JSON.stringify(
				headerSetId == null ? {} : (headersBySetId.get(headerSetId) ?? {}),
			),
			meta_extras: decodeJsonRef(extras_body, extras_codec),
			networkLogs: null,
		};
	});
}
