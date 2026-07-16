import type { DB_Page } from '../../../types.js';
import type { Knex } from 'knex';

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
 * string) for a batch of raw page rows, batching the `header_set_entries`
 * lookup across every distinct `headerSetId` in the batch (one query, not
 * N+1) and decoding each row's `json_refs` body independently. `networkLogs`
 * has no 0.13 equivalent (it is a legacy-only field nothing ever wrote past
 * the pre-0.13 write path either) and is always `null`.
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
	const headersBySetId = new Map<number, Record<string, string>>();
	if (headerSetIds.length > 0) {
		const headerRows = (await knex('header_set_entries as hse')
			.join('header_name_refs as hnr', 'hnr.id', 'hse.name_id')
			.join('header_value_refs as hvr', 'hvr.id', 'hse.value_id')
			.whereIn('hse.header_set_id', headerSetIds)
			.orderBy(['hse.header_set_id', 'hnr.name', 'hse.occurrence'])
			.select(
				'hse.header_set_id as headerSetId',
				'hnr.name as name',
				'hvr.value as value',
			)) as { headerSetId: number; name: string; value: string }[];
		const merged = new Map<number, Map<string, string[]>>();
		for (const row of headerRows) {
			const bySet = merged.get(row.headerSetId) ?? new Map<string, string[]>();
			const values = bySet.get(row.name) ?? [];
			values.push(row.value);
			bySet.set(row.name, values);
			merged.set(row.headerSetId, bySet);
		}
		for (const [setId, bySet] of merged) {
			headersBySetId.set(
				setId,
				Object.fromEntries([...bySet.entries()].map(([k, v]) => [k, v.join(', ')])),
			);
		}
	}

	return Promise.all(
		rows.map(async (row) => {
			const { headerSetId, extras_body, extras_codec, ...rest } = row;
			return {
				...rest,
				responseHeaders: JSON.stringify(
					headerSetId == null ? {} : (headersBySetId.get(headerSetId) ?? {}),
				),
				meta_extras: await decodeMetaExtras(extras_body, extras_codec),
				networkLogs: null,
			};
		}),
	);
}

/**
 * Decodes a `page_meta.meta_extras_json_id` payload back into the
 * JSON-serialised `meta_extras` string `DB_Page` expects. Corrupt bodies
 * fail closed to `null` rather than throwing, matching the pre-0.13
 * try/catch shape.
 * @param body - The raw `json_refs.json_text` body, or null when absent.
 * @param codec - The `json_refs.codec` value (`'zstd'` or `'none'`), or null when absent.
 * @returns The decoded JSON string, or null when there is no body.
 */
async function decodeMetaExtras(
	body: Buffer | string | null,
	codec: 'zstd' | 'none' | null,
): Promise<string | null> {
	if (body == null) {
		return null;
	}
	try {
		if (codec === 'zstd') {
			const { zstdDecompressSync } = await import('node:zlib');
			return zstdDecompressSync(body as Buffer).toString('utf8');
		}
		return typeof body === 'string' ? body : body.toString('utf8');
	} catch {
		return null;
	}
}
