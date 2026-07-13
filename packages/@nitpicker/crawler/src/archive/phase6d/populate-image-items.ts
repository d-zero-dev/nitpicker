import type { DomPathResult } from './types.js';
import type { Knex } from 'knex';

import { DATA_URI_URL_REFS_LIMIT } from '../phase6b/data-uri-url-refs-limit.js';

import { resolveBlobRefs } from './resolve-blob-refs.js';
import { resolveTextRefs } from './resolve-text-refs.js';
import { resolveUrlRefs } from './resolve-url-refs.js';
import { upsertTextRefs } from './upsert-text-refs.js';

/**
 * Page ids scanned per keyset-paginated `SELECT DISTINCT pageId` chunk.
 * Batches the outer loop so 470 K pages worth of `images` rows are
 * traversed in ~1 K round trips instead of one round-trip per page,
 * without holding the entire distinct-pageId list in memory at once.
 */
const PAGE_ID_CHUNK_SIZE = 500;

/**
 * Rows sent per `INSERT INTO image_items ... VALUES (...)` statement.
 * Each row binds 13 params, so 300 rows = 3 900 params — safely under
 * the SQLite variable limit.
 */
const INSERT_CHUNK_SIZE = 300;

/**
 * Callback that resolves DOM-path strings for one page's images. The
 * callback receives the page's HTML string (or `null` when no snapshot
 * is stored) plus the page's `images` rows, and must return one
 * {@link DomPathResult} per row.
 *
 * Injected rather than hard-coded so `@nitpicker/crawler` does not
 * become a jsdom consumer at runtime — the migration script
 * (`scripts/migrate-to-phase6.mjs`) wires a jsdom-backed
 * implementation, while unit tests inject stubs. A future crawler-time
 * DOM-path capture (Phase 6-G) can use the same signature with
 * puppeteer-backed elements.
 */
export type PageDomPathResolver = (
	pageId: number,
	htmlString: string | null,
	images: readonly ImageRowForResolver[],
) => Promise<ReadonlyMap<number, DomPathResult>>;

/**
 * The projection of `images` rows passed to a
 * {@link PageDomPathResolver}. Kept as a narrow shape (only the fields
 * the resolver needs) so callers of the resolver do not depend on the
 * full row width.
 */
export interface ImageRowForResolver {
	/** Legacy `images.id`. */
	id: number;
	/** Legacy `images.sourceCode`. */
	sourceCode: string | null;
}

/**
 * Populates `image_items` from `images` (issue #193 step 6-D-6).
 *
 * The outer loop iterates **pages**, not images. Each page's images are
 * processed as one whole unit — dom-path derivation, HTML BLOB fetch,
 * and ref lookups all happen once per page. This design closes three
 * separate correctness / efficiency traps that a purely image-chunked
 * loop would expose:
 *
 * 1. **Ordinal-cursor bleed across chunks** — `matchImagesToDomPaths`
 *    tracks per-outerHTML cursor state, so a page with 1 000 identical
 *    `<img>` tags spanning two image-chunks would reset the cursor at
 *    the boundary and duplicate dom_paths already assigned in the
 *    previous chunk. Iterating by page keeps every page's cursor state
 *    self-contained.
 * 2. **Repeated `getPageHtml` + jsdom parse** — a page whose images
 *    straddle N image-chunks would fetch and re-parse the same multi-MB
 *    HTML snapshot N times. Iterating by page makes this exactly once
 *    per page.
 * 3. **Data-URI routing gap** — legacy `images.src` can be either a
 *    plain URL (goes to `url_refs`) or a large `data:` URI (goes to
 *    `blob_refs`, per the 512-byte threshold). The lookups partition
 *    by that rule, so a data URI is never bound into
 *    `resolveUrlRefs`' `WHERE url IN (?)` — which could otherwise
 *    exceed SQLite's `SQLITE_MAX_SQL_LENGTH` for multi-KB URIs.
 *
 * Per outer iteration:
 *
 * 1. **Keyset-paginate** distinct `pageId` values from `images`. Peak
 *    memory ≈ 500 integers.
 * 2. **Fetch all images** for those page ids in one query, ordered by
 *    `(pageId, id)` so JS-side grouping is a linear pass.
 * 3. **Resolve dom paths per page** — one `getPageHtml` + one resolver
 *    call each. `dom_path` texts are collected across the whole batch
 *    so `upsertTextRefs` runs once per batch.
 * 4. **Partition src / currentSrc** by the data-URI routing rule and
 *    batch-resolve url refs, blob refs, and alt text refs across the
 *    whole batch.
 * 5. **Bulk INSERT** with explicit `id = images.id`.
 *
 * `INSERT OR IGNORE` on the natural PK makes the step idempotent.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @param resolvePageDomPaths - Callback that returns dom_path strings
 *   for one page's images (see {@link PageDomPathResolver}).
 * @param getPageHtml - Callback returning the HTML string for one
 *   `pages.id` (typically wraps `getHtmlOfPageById`). Returns `null`
 *   when the page has no stored snapshot.
 * @example
 * const jsdomResolver = createJsdomResolver();
 * await knex.transaction(async (trx) => {
 *   await populateImageItems(trx, jsdomResolver, (pid) => db.getHtmlOfPageById(pid));
 * });
 */
export async function populateImageItems(
	trx: Knex,
	resolvePageDomPaths: PageDomPathResolver,
	getPageHtml: (pageId: number) => Promise<string | null>,
): Promise<void> {
	let cursorPageId = 0;
	while (true) {
		const pageIdRows: { pageId: number }[] = await trx('images')
			.distinct('pageId')
			.where('pageId', '>', cursorPageId)
			.orderBy('pageId', 'asc')
			.limit(PAGE_ID_CHUNK_SIZE);
		if (pageIdRows.length === 0) {
			break;
		}
		const pageIds = pageIdRows.map((r) => r.pageId);
		cursorPageId = pageIds.at(-1)!;

		const rows: ImageRow[] = await trx('images')
			.select(
				'id',
				'pageId',
				'src',
				'currentSrc',
				'alt',
				'width',
				'height',
				'naturalWidth',
				'naturalHeight',
				'isLazy',
				'viewportWidth',
				'sourceCode',
			)
			.whereIn('pageId', pageIds)
			.orderBy([
				{ column: 'pageId', order: 'asc' },
				{ column: 'id', order: 'asc' },
			]);
		if (rows.length === 0) {
			continue;
		}

		const byPage = new Map<number, ImageRow[]>();
		for (const row of rows) {
			const bucket = byPage.get(row.pageId);
			if (bucket === undefined) {
				byPage.set(row.pageId, [row]);
			} else {
				bucket.push(row);
			}
		}

		const domPaths = new Map<number, DomPathResult>();
		for (const [pageId, pageImages] of byPage) {
			const html = await getPageHtml(pageId);
			const resolved = await resolvePageDomPaths(pageId, html, pageImages);
			for (const [imageId, entry] of resolved) {
				domPaths.set(imageId, entry);
			}
		}

		const urls = new Set<string>();
		const dataUris = new Set<string>();
		const alts = new Set<string>();
		const domPathTexts = new Set<string>();
		for (const row of rows) {
			for (const value of [row.src, row.currentSrc]) {
				if (typeof value !== 'string' || value === '') {
					continue;
				}
				if (isBlobRefValue(value)) {
					dataUris.add(value);
				} else {
					urls.add(value);
				}
			}
			if (typeof row.alt === 'string' && row.alt !== '') {
				alts.add(row.alt);
			}
			const domPath = domPaths.get(row.id);
			if (domPath !== undefined) {
				domPathTexts.add(domPath.path);
			}
		}
		const urlIds = await resolveUrlRefs(trx, urls);
		const blobIds = await resolveBlobRefs(trx, dataUris);
		const altIds = await resolveTextRefs(trx, alts);
		// `dom_path` strings are synthesised at Phase 6-D-6 and were not
		// among the Phase 6-B-2 text sources — insert every distinct
		// derived path (including `unknown/<id>` fallbacks) before
		// resolving its id. The upsert is idempotent so re-runs across
		// partial failures do not duplicate rows.
		const domPathIds = await upsertTextRefs(trx, domPathTexts);

		const inserts: Record<string, unknown>[] = [];
		for (const row of rows) {
			const domPath = domPaths.get(row.id);
			if (domPath === undefined) {
				throw new Error(
					`populateImageItems: dom_path not resolved for image id=${row.id}`,
				);
			}
			const domPathId = domPathIds.get(domPath.path);
			if (domPathId === undefined) {
				throw new Error(
					`populateImageItems: text_refs.id not resolved for dom_path=${domPath.path} — the upsertTextRefs above must have inserted it`,
				);
			}
			const srcSlot = resolveUrlOrBlob(row.src, urlIds, blobIds);
			const currentSrcSlot = resolveUrlOrBlob(row.currentSrc, urlIds, blobIds);
			inserts.push({
				id: row.id,
				page_id: row.pageId,
				src_url_id: srcSlot.url,
				current_src_url_id: currentSrcSlot.url,
				src_blob_id: srcSlot.blob,
				current_src_blob_id: currentSrcSlot.blob,
				alt_text_id:
					typeof row.alt === 'string' && row.alt !== ''
						? (altIds.get(row.alt) ?? null)
						: null,
				width: row.width,
				height: row.height,
				natural_width: row.naturalWidth,
				natural_height: row.naturalHeight,
				is_lazy: row.isLazy == null ? null : row.isLazy ? 1 : 0,
				viewport_width: row.viewportWidth,
				dom_path_text_id: domPathId,
			});
		}

		for (let index = 0; index < inserts.length; index += INSERT_CHUNK_SIZE) {
			const chunk = inserts.slice(index, index + INSERT_CHUNK_SIZE);
			await trx('image_items').insert(chunk).onConflict('id').ignore();
		}
	}
}

/**
 * Predicate matching Phase 6-B-1's routing rule: a `data:` URI whose
 * length exceeds {@link DATA_URI_URL_REFS_LIMIT} lands in `blob_refs`;
 * anything else (regular URL or short data URI) lands in `url_refs`.
 * @param value - Raw `src` / `currentSrc` column value.
 */
function isBlobRefValue(value: string): boolean {
	return value.startsWith('data:') && value.length > DATA_URI_URL_REFS_LIMIT;
}

/**
 * Routes one legacy `src` / `currentSrc` value to either `url_refs` or
 * `blob_refs` per the plan's data-URI threshold rule. Exactly one of
 * `url` / `blob` is non-null; both may be `null` when the value is null
 * or fails to resolve (e.g. the `blob_refs` row is missing because the
 * data URI was malformed and skipped by `populateBlobRefs`).
 *
 * Colocated with {@link populateImageItems} rather than exported as its
 * own file because it exists solely to serve this one call site and
 * captures three parameters (value + both id maps) that are not
 * meaningful to any other caller.
 * @param value - Raw `src` / `currentSrc` column value.
 * @param urlIds - Map of URL string → `url_refs.id`.
 * @param blobIds - Map of data-URI string → `blob_refs.id`.
 * @returns `{ url, blob }` pair with at most one non-null field.
 */
function resolveUrlOrBlob(
	value: string | null,
	urlIds: ReadonlyMap<string, number>,
	blobIds: ReadonlyMap<string, number>,
): { url: number | null; blob: number | null } {
	if (typeof value !== 'string' || value === '') {
		return { url: null, blob: null };
	}
	if (isBlobRefValue(value)) {
		return { url: null, blob: blobIds.get(value) ?? null };
	}
	return { url: urlIds.get(value) ?? null, blob: null };
}

/**
 * One row read from the legacy `images` table by
 * {@link populateImageItems}. Every column mapped to `image_items` is
 * declared; internal-only helper columns are absent.
 */
interface ImageRow {
	/** Legacy `images.id`, reused verbatim as `image_items.id`. */
	id: number;
	/** Legacy `images.pageId` — `content_items.id` of the owning page. */
	pageId: number;
	/** Legacy `images.src` — routed to `src_url_id` or `src_blob_id`. */
	src: string | null;
	/** Legacy `images.currentSrc` — routed to `current_src_url_id` or `current_src_blob_id`. */
	currentSrc: string | null;
	/** Legacy `images.alt` — resolved to `alt_text_id` via `text_refs`. */
	alt: string | null;
	/** Legacy `images.width` — copied verbatim. */
	width: number;
	/** Legacy `images.height` — copied verbatim. */
	height: number;
	/** Legacy `images.naturalWidth` — copied to `natural_width`. */
	naturalWidth: number;
	/** Legacy `images.naturalHeight` — copied to `natural_height`. */
	naturalHeight: number;
	/** Legacy `images.isLazy` — copied to `is_lazy`. */
	isLazy: boolean | number | null;
	/** Legacy `images.viewportWidth` — copied to `viewport_width`. */
	viewportWidth: number;
	/** Legacy `images.sourceCode` — the outerHTML fed to the dom-path resolver. */
	sourceCode: string | null;
}
