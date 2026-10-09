import type Archive from '../archive.js';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';

import { eachSplitted } from '../utils/array/each-splitted.js';

/**
 * SQLite has a hard cap of 999 bound variables per statement. A real archive
 * can have far more than 999 CSS-referencing edges or pages, so every
 * `whereIn` below is chunked at this size.
 *
 * Independently duplicated (not shared/imported) from `@nitpicker/query`'s
 * `compute-isolated-clusters.ts`, which defines the identical
 * `SQLITE_IN_CHUNK = 500` for the same reason. If this margin below 999 ever
 * needs revisiting, update both — there is no shared module either package
 * depends on to hold one copy.
 */
const SQLITE_IN_CHUNK = 500;

/**
 * Collects, for every page that references at least one CSS stylesheet, the
 * set of stylesheet URLs it references.
 *
 * Reads in three narrow passes instead of one wide JOIN, to avoid
 * materializing the full page×stylesheet edge set at once — a real
 * 486,000-page archive has ~2.5 million such edges, and a single JOIN
 * projecting both URL strings for all of them is a transient allocation
 * spike well beyond what any single page's data actually needs:
 *
 * 1. Resolve which `resource_items` rows are classified `'css'`
 *    (`content_type_refs.category`) and their stylesheet URL.
 * 2. Resolve `resource_ref_edges` for just those CSS resource ids, in
 *    chunks, projecting only the two integer ids per row.
 * 3. Resolve the page ids collected in step 2 to their URLs.
 *
 * Identical stylesheet-URL arrays are interned across pages: pages sharing a
 * template share the same CSS set, so the number of distinct arrays
 * converges to a few hundred even across hundreds of thousands of pages.
 * @param archive - The archive to read from.
 * @returns Map from page URL (parseUrl-normalized `href`, matching
 *   `Page.url.href`) to the stylesheet URLs it references. Pages that
 *   reference no CSS resource have no entry — callers should default to an
 *   empty array on a missed lookup.
 * @example
 * ```ts
 * const stylesheetsByUrl = await collectPageStylesheetUrls(archive);
 * const hrefs = stylesheetsByUrl.get(page.url.href) ?? [];
 * ```
 */
export async function collectPageStylesheetUrls(
	archive: Archive,
): Promise<Map<string, readonly string[]>> {
	const knex = archive.getKnex();

	const cssResources = (await knex('resource_items as ri')
		.join('content_type_refs as ctr', 'ctr.id', 'ri.content_type_id')
		.where('ctr.category', 'css')
		.select('ri.id as id', 'ri.url_id as urlId')) as {
		id: number;
		urlId: number | null;
	}[];

	// A CSS resource identified by a `data:` URI (routed to `blob_refs`
	// instead of `url_refs`, `resource_items.url_blob_id`) has no stylesheet
	// URL to report — skip it rather than passing a `null` into `whereIn`.
	const cssResourcesWithUrl = cssResources.filter(
		(r): r is { id: number; urlId: number } => r.urlId != null,
	);
	if (cssResourcesWithUrl.length === 0) {
		return new Map();
	}

	const cssUrlById = new Map<number, string>();
	await eachSplitted(
		cssResourcesWithUrl.map((r) => r.urlId),
		SQLITE_IN_CHUNK,
		async (chunk) => {
			const rows = (await knex('url_refs').whereIn('id', chunk).select('id', 'url')) as {
				id: number;
				url: string;
			}[];
			for (const row of rows) {
				cssUrlById.set(row.id, row.url);
			}
		},
	);

	const cssUrlByResourceId = new Map<number, string>();
	for (const r of cssResourcesWithUrl) {
		const url = cssUrlById.get(r.urlId);
		if (url) {
			cssUrlByResourceId.set(r.id, url);
		}
	}

	const resourceIdsByPageId = new Map<number, number[]>();
	await eachSplitted(
		cssResourcesWithUrl.map((r) => r.id),
		SQLITE_IN_CHUNK,
		async (chunk) => {
			const rows = (await knex('resource_ref_edges')
				.whereIn('resource_id', chunk)
				.select('resource_id as resourceId', 'page_id as pageId')) as {
				resourceId: number;
				pageId: number;
			}[];
			// Avoid `push(...rows)`: on large real archives this chunk array can
			// be large enough to overflow V8's argument-spread limit even though
			// the underlying data itself fits in memory.
			for (const row of rows) {
				const existing = resourceIdsByPageId.get(row.pageId);
				if (existing) {
					existing.push(row.resourceId);
				} else {
					resourceIdsByPageId.set(row.pageId, [row.resourceId]);
				}
			}
		},
	);

	if (resourceIdsByPageId.size === 0) {
		return new Map();
	}

	const pageUrlById = new Map<number, string>();
	await eachSplitted([...resourceIdsByPageId.keys()], SQLITE_IN_CHUNK, async (chunk) => {
		const rows = (await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.whereIn('ci.id', chunk)
			.select('ci.id as id', 'ur.url as url')) as { id: number; url: string }[];
		for (const row of rows) {
			pageUrlById.set(row.id, row.url);
		}
	});

	const internedSets = new Map<string, readonly string[]>();
	const result = new Map<string, readonly string[]>();
	for (const [pageId, resourceIds] of resourceIdsByPageId) {
		const pageUrlRaw = pageUrlById.get(pageId);
		if (!pageUrlRaw) {
			continue;
		}
		const parsed = parseUrl(pageUrlRaw);
		if (!parsed) {
			continue;
		}

		const urls = resourceIds
			.map((id) => cssUrlByResourceId.get(id))
			.filter((url): url is string => url != null)
			.toSorted();
		if (urls.length === 0) {
			continue;
		}

		const internKey = urls.join(' ');
		let interned = internedSets.get(internKey);
		if (!interned) {
			interned = Object.freeze(urls);
			internedSets.set(internKey, interned);
		}
		result.set(parsed.href, interned);
	}

	return result;
}
