/** One content-addressable dictionary table's copy contract. */
export interface DictionaryCopySpec {
	/** Table name (same in both `main` and the attached source). */
	readonly table: string;
	/**
	 * Column(s) forming the natural (content-addressed) key used both as
	 * the `ON CONFLICT` target on insert and to re-resolve the
	 * destination id for every source row afterwards. This is
	 * DELIBERATELY not always the table's `UNIQUE` constraint used at
	 * write time — see `header_sets`' entry below.
	 */
	readonly naturalKey: readonly string[];
}

/**
 * Every dictionary table a transfer copies (concat and split alike), in
 * dependency order (independent dictionaries first; `header_sets` before
 * its `header_set_entries`/`header_flags` children — handled separately in
 * `copy-header-set-children.ts` since they have no own id to map;
 * `console_log_items` has no cross-dictionary FKs of
 * its own, so ordering relative to the others does not matter).
 *
 * `header_sets`' natural key is `raw_hash` alone, not
 * `(raw_json_hash, raw_hash)` — `raw_json_hash` is BLAKE3 of the raw
 * `responseHeaders` JSON STRING (kept only for the pre-0.13 migration
 * lookup, per `create-ref-tables.ts`'s docs) and can differ between two
 * byte-for-byte-different JSON serialisations of the exact same header
 * set (key order, whitespace), whereas `raw_hash` is BLAKE3 of the
 * decomposed, sorted `name=value` pairs — the actual dedup identity every
 * live write computes against. Two archives crawling the same site
 * therefore share a `raw_hash` far more reliably than a `raw_json_hash`.
 */
export const DICTIONARY_COPY_SPECS: readonly DictionaryCopySpec[] = [
	{ table: 'url_refs', naturalKey: ['url'] },
	{ table: 'content_type_refs', naturalKey: ['raw'] },
	{ table: 'text_refs', naturalKey: ['hash', 'text'] },
	{ table: 'json_refs', naturalKey: ['hash'] },
	{ table: 'blob_refs', naturalKey: ['hash'] },
	{ table: 'header_name_refs', naturalKey: ['name'] },
	{ table: 'header_value_refs', naturalKey: ['hash', 'value'] },
	{ table: 'header_sets', naturalKey: ['raw_hash'] },
];
