import type { HeaderTableCaches } from '../../populate-ref-tables/types.js';
import type { PageSource } from '../../types.js';

/**
 * One cached `content_items` identity: the row id plus the provenance
 * label at the time it was last read or written through the cache. The
 * `source` copy lets {@link ../_shared/resolve-content-item-id.ts} apply
 * the crawled-wins downgrade without re-reading the row on every anchor
 * hit.
 */
export interface ContentItemCacheEntry {
	/** `content_items.id`. */
	id: number;
	/** `content_items.source` as last observed / written by this process. */
	source: PageSource;
}

/**
 * In-process id caches shared across one archive connection's write path.
 *
 * Every ref-table upsert primitive under `db-ops/_shared/` consults these
 * maps before touching SQL. The caches are correct for the lifetime of a
 * single writer connection because ref rows are append-only (`url_refs`,
 * `text_refs`, `json_refs`, `blob_refs`, `content_type_refs`, header
 * dictionaries never delete rows) and `content_items` identities
 * (`id`, `url_id`) are never reassigned — only the cached `source` can
 * change, and the sole writer of that column is the cache-aware downgrade
 * in `resolve-content-item-id.ts` itself.
 *
 * NOT safe to share across processes or across two concurrent writer
 * connections — the crawler holds a single writer connection per archive
 * (enforced by the archive lock), so no such sharing exists.
 */
export interface WriteRefCaches {
	/** `url string → url_refs.id`. */
	readonly urlIds: Map<string, number>;
	/** `url string → content_items` identity (id + last-known source). */
	readonly contentItems: Map<string, ContentItemCacheEntry>;
	/** `url string → resource_items.id`. */
	readonly resourceIds: Map<string, number>;
	/** `normalized content-type raw value → content_type_refs.id`. */
	readonly contentTypeIds: Map<string, number>;
	/** `hex(content hash) → json_refs.id`. */
	readonly jsonIds: Map<string, number>;
	/** `hex(content hash) → blob_refs.id`. */
	readonly blobIds: Map<string, number>;
	/**
	 * Header dictionary caches (`header_name_refs` / `header_value_refs` /
	 * `header_sets` id maps). `null` until the first header-set upsert
	 * warms them from the DB — warming issues three SELECTs, which a
	 * crawl that never stores headers (e.g. list-mode with no responses)
	 * should not pay for.
	 */
	headers: HeaderTableCaches | null;
}
