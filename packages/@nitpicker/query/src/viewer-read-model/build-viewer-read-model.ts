import type { ArchiveAccessor } from '@nitpicker/crawler';

import { eachSplitted } from '@nitpicker/crawler';

import { classifyContentType } from '../classify-content-type.js';
import { excludeSkippedPages } from '../exclude-skipped-pages.js';

import { createViewerReadModelTables } from './create-viewer-read-model-tables.js';
import { dropViewerReadModelTables } from './drop-viewer-read-model-tables.js';
import { VIEWER_READ_MODEL_SCHEMA_VERSION } from './viewer-read-model-schema-version.js';

/** Number of rows written per `INSERT` statement while populating `viewer_pages`. */
const INSERT_CHUNK_SIZE = 500;

/**
 * Row shape read from the write-model `pages` table while populating
 * `viewer_pages`. Column names match `pages` verbatim (see
 * `@nitpicker/crawler`'s `init-schema.ts` and this package's
 * `list-pages.ts`, which filters/sorts on the same columns).
 */
interface PagesSourceRow {
	/** `pages.id` — becomes `viewer_pages.page_id`. */
	id: number;
	/** The page's absolute URL. */
	url: string;
	/** The page's `<title>` text, or `null` when absent. */
	title: string | null;
	/** HTTP status code, or `null` for not-yet-classified/errored rows. */
	status: number | null;
	/** Raw `Content-Type` response header value, or `null`. */
	contentType: string | null;
	/**
	 * `1`/`0` when known, `null` on legacy rows written before this column
	 * was backfilled (the `pages.isExternal` column has no `NOT NULL`
	 * constraint — see `init-schema.ts`).
	 */
	isExternal: number | null;
	/** The page's meta description text, or `null` when absent. */
	description: string | null;
	/** The page's `og:title` text, or `null` when absent. */
	og_title: string | null;
	/**
	 * `1`/`0` when known, `null` when no `<meta name="robots">` tag was
	 * ever parsed (the `pages.robots_noindex` column has no `NOT NULL`
	 * constraint — see `init-schema.ts`).
	 */
	robots_noindex: number | null;
	/** Denormalised count of Wappalyzer tags detected on the page. */
	tag_count: number | null;
	/** Denormalised count of JSON-LD / SpeculationRules entries on the page. */
	jsonld_count: number | null;
}

/** One row to insert into `viewer_pages`, derived from a {@link PagesSourceRow}. */
interface ViewerPageInsertRow {
	/** Copied from `PagesSourceRow.id`. */
	page_id: number;
	/** Copied from `PagesSourceRow.url`. */
	url: string;
	/** Copied from `PagesSourceRow.title`. */
	title: string | null;
	/** Copied from `PagesSourceRow.status`. */
	status: number | null;
	/** `classifyContentType(PagesSourceRow.contentType)`. */
	content_category: string;
	/** Normalised `0`/`1` form of `PagesSourceRow.isExternal`. */
	is_external: number;
	/** `1` iff `title` is non-null and non-empty. */
	has_title: number;
	/** `1` iff `description` is non-null and non-empty. */
	has_description: number;
	/** `1` iff `og_title` is non-null and non-empty. */
	has_og_title: number;
	/** Normalised `0`/`1` form of `PagesSourceRow.robots_noindex`. */
	robots_noindex: number;
	/** `PagesSourceRow.tag_count`, defaulted to `0` when `null`. */
	tag_count: number;
	/** `PagesSourceRow.jsonld_count`, defaulted to `0` when `null`. */
	jsonld_count: number;
	/**
	 * Case-preserving sort key for URL ordering — currently just `url`
	 * verbatim, matching `listPages`'s plain `ORDER BY url` (SQLite's
	 * default `BINARY` collation is case-sensitive; lower-casing here would
	 * be a behavior change, left to whichever issue actually wires up
	 * `/api/pages` sorting).
	 */
	url_sort_key: string;
	/** Case-preserving sort key for title ordering — `title` verbatim. */
	title_sort_key: string | null;
	/**
	 * The URL's path component, for directory-prefix range scans (per
	 * `docs/viewer-sql-query-plan.md`'s `/api/pages` directory filter
	 * notes). Stored now but intentionally has no index and no reader yet
	 * in #108 — like `viewer_page_anchors`, wiring the actual directory
	 * filter query/index is out of scope here and belongs to whichever
	 * issue implements `/api/pages`'s directory filter.
	 */
	path_sort_key: string;
}

/**
 * Derives the path-only sort key used for directory-prefix filtering.
 * Falls back to the full URL string when it cannot be parsed as a URL
 * (defensive only — every URL in `pages` was already parsed once during
 * crawling, so this branch should not be reachable in practice).
 * @param url - The page's absolute URL.
 * @returns The URL's pathname, or `url` itself if unparseable.
 */
function derivePathSortKey(url: string): string {
	try {
		return new URL(url).pathname;
	} catch {
		return url;
	}
}

/**
 * Maps one `pages` row to its `viewer_pages` insert row.
 * @param row - The source row read from `pages`.
 * @returns The corresponding `viewer_pages` insert row.
 */
function toViewerPageInsertRow(row: PagesSourceRow): ViewerPageInsertRow {
	return {
		page_id: row.id,
		url: row.url,
		title: row.title,
		status: row.status,
		content_category: classifyContentType(row.contentType),
		is_external: row.isExternal ? 1 : 0,
		has_title: row.title != null && row.title !== '' ? 1 : 0,
		has_description: row.description != null && row.description !== '' ? 1 : 0,
		has_og_title: row.og_title != null && row.og_title !== '' ? 1 : 0,
		robots_noindex: row.robots_noindex ? 1 : 0,
		tag_count: row.tag_count ?? 0,
		jsonld_count: row.jsonld_count ?? 0,
		url_sort_key: row.url,
		title_sort_key: row.title,
		path_sort_key: derivePathSortKey(row.url),
	};
}

/**
 * Performs a full rebuild of the viewer read model: drops all 5 tables if
 * present, recreates them, populates `viewer_pages` from the current
 * `pages` write-model table, seeds one smoke-test row into
 * `viewer_query_profiles` and `viewer_count_buckets`, and writes the
 * `viewer_read_model_meta` row — all inside one transaction, so a mid-build
 * failure leaves the previous read model (or no read model) intact, never a
 * partially-built one.
 *
 * `viewer_pages` includes every listable page regardless of content-type
 * category (`scraped = 1 AND redirectDestId IS NULL`, plus excluding
 * `isSkipped` discovery-only placeholder rows — the same predicate
 * `Database.resetFailedPages` and `excludeSkippedPages` guard against, see
 * that helper's docs for the production incident that motivated it).
 * `content_category` is stored as a column precisely so a future
 * `/api/pages` consumer can filter by it; unlike `listPages`'s *default*
 * view (which only shows HTML + not-yet-classified rows), this table is
 * intentionally NOT pre-filtered to that subset — unfiltered totals here
 * can legitimately exceed `listPages(accessor, {}).total` on an archive
 * that also has known non-HTML pages (PDFs, images, etc.).
 *
 * `viewer_page_anchors` is created but left with zero rows: populating it
 * requires real pagination-cursor math tied to a specific page size/page
 * number, which belongs to whichever issue actually wires up `/api/pages`
 * page-number jumps.
 *
 * Always a full rebuild — there is no incremental/diff path.
 * @param accessor - The archive accessor to build against. Must be
 *   writable (`accessor.readOnly === false`) — typically an `Archive`
 *   returned by `Archive.create`/`Archive.open`, not `Archive.connect`/
 *   `Archive.openCached` (always read-only) or a stub-mode accessor.
 * @throws {Error} When `accessor.readOnly` is `true`.
 * @example
 * // Typically called once, right after a crawl finishes writing `pages`:
 * await buildViewerReadModel(archive);
 */
export async function buildViewerReadModel(accessor: ArchiveAccessor): Promise<void> {
	if (accessor.readOnly) {
		throw new Error(
			'buildViewerReadModel: cannot build the viewer read model on a read-only ' +
				'ArchiveAccessor (stub-mode, or an accessor opened via Archive.connect / ' +
				'Archive.openCached). The read model may only be built against a writable ' +
				'Archive (Archive.create / Archive.open), typically from the crawl-completion step.',
		);
	}

	const knex = accessor.getKnex();
	await knex.transaction(async (trx) => {
		await dropViewerReadModelTables(trx);
		await createViewerReadModelTables(trx);

		const sourceRows: PagesSourceRow[] = await trx('pages')
			.where('scraped', 1)
			.whereNull('redirectDestId')
			.where((qb) => excludeSkippedPages(qb))
			.select(
				'id',
				'url',
				'title',
				'status',
				'contentType',
				'isExternal',
				'description',
				'og_title',
				'robots_noindex',
				'tag_count',
				'jsonld_count',
			);

		const insertRows = sourceRows.map(toViewerPageInsertRow);

		await eachSplitted(insertRows, INSERT_CHUNK_SIZE, async (chunk) => {
			if (chunk.length > 0) {
				await trx('viewer_pages').insert(chunk);
			}
		});

		const total = insertRows.length;
		await trx('viewer_query_profiles').insert({
			scope: 'pages',
			profile_key: 'default',
			sort_key: 'url_sort_key',
			sort_order: 'asc',
			total,
		});
		await trx('viewer_count_buckets').insert({
			scope: 'pages',
			key: 'total',
			value: 'all',
			count: total,
		});

		await trx('viewer_read_model_meta').insert({
			id: 1,
			schema_version: VIEWER_READ_MODEL_SCHEMA_VERSION,
			built_at: Date.now(),
			source_row_count: total,
		});
	});
}
