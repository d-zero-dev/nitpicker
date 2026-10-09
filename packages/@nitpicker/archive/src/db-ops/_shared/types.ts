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
	/**
	 * `content_items.is_metadata_only` as last observed / written by this
	 * process. Lets {@link ../_shared/resolve-content-item-id.ts} skip a
	 * redundant `UPDATE` when a later resolution recomputes the same value.
	 */
	isMetadataOnly: 0 | 1;
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
	/** `hex(content hash) → console_log_items.id`. */
	readonly consoleLogIds: Map<string, number>;
	/**
	 * Header dictionary caches (`header_name_refs` / `header_value_refs` /
	 * `header_sets` id maps). `null` until the first header-set upsert
	 * warms them from the DB — warming issues three SELECTs, which a
	 * crawl that never stores headers (e.g. list-mode with no responses)
	 * should not pay for.
	 */
	headers: HeaderTableCaches | null;
}

/**
 * Optional per-call flags for {@link ../_shared/resolve-content-item-id.ts}.
 */
export interface ResolveContentItemIdOptions {
	/**
	 * `1` marks the row as an external URL that will never be scraped as a
	 * target. Recorded on new inserts only. Defaults to `0` (in-scope) on
	 * insert, mirroring the legacy column default.
	 */
	isExternal?: 0 | 1;
	/**
	 * Provenance label put on a newly-inserted row. Omit to let the
	 * `content_items.source` DEFAULT (`'crawled'`) apply. Pass `'crawled'`
	 * to arm the crawled-wins downgrade on existing inventory-labelled rows.
	 */
	source?: PageSource;
	/**
	 * `1` marks the row as fated for a metadata-only (title-only) scrape
	 * rather than a full one, `0` explicitly marks it as a full-scrape
	 * target. Omit (the default for every caller except
	 * `replaceAnchorEdges`) to leave the column untouched — those callers
	 * (redirects, resources, errors, skipped pages, console logs) have no
	 * opinion on scrape depth and must not clobber a value an
	 * anchor-discovery call already established.
	 * `!options.recursive || anchor.isExternal` is a pure function of the
	 * URL within one crawl session (`recursive` is session-constant,
	 * `isExternal` depends only on scope matching), so every anchor-path
	 * call for the same URL always recomputes the same value — there is no
	 * real conflict to arbitrate between two *opinionated* calls, only
	 * between an opinionated call and the unopinionated majority.
	 */
	isMetadataOnly?: 0 | 1;
}
