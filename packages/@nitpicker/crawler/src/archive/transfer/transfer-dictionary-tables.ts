/**
 * The fixed set of dictionary tables a transfer's need-based dictionary
 * copy tracks per-id "is this row referenced by anything kept" state for.
 * Drives the loop in {@link import('./create-transfer-temp-tables.js').createTransferTempTables} /
 * {@link import('./drop-transfer-temp-tables.js').dropTransferTempTables}
 * that creates/drops one `(src_id PRIMARY KEY)` need-table and one
 * `(src_id PRIMARY KEY, dest_id)` map-table per dictionary — every
 * dictionary table shares that exact temp-table shape, only the
 * population query differs (see `copy-dictionaries-for-concat.ts` /
 * `copy-dictionaries-for-split.ts`).
 */
export const TRANSFER_DICTIONARY_TABLES: readonly string[] = [
	'url_refs',
	'content_type_refs',
	'text_refs',
	'json_refs',
	'blob_refs',
	'header_name_refs',
	'header_value_refs',
	'header_sets',
	'console_log_items',
	'analysis_text_refs',
];
