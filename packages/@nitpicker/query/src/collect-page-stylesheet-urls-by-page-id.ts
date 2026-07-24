import type { ArchiveAccessor } from '@nitpicker/crawler';

import { eachSplitted } from '@nitpicker/crawler';

import { SQLITE_IN_CHUNK } from './sqlite-in-chunk.js';

/**
 * Collects, for every page that references at least one CSS stylesheet, the
 * set of stylesheet URLs it references — keyed by `page_id` rather than by
 * URL string.
 *
 * This is a `page_id`-keyed sibling of `@nitpicker/core`'s
 * `collectPageStylesheetUrls`: that function resolves each page's `id` all
 * the way to its URL (needed by template classification, which only has
 * `Page.url.href` on hand), but callers that already have a `page_id` (e.g.
 * grouping stylesheet sets by `page_templates.template_key`) don't need that
 * extra resolution pass — skipping it removes one of the three SQL passes
 * entirely.
 *
 * Reads in two narrow passes instead of one wide JOIN, to avoid materializing
 * the full page×stylesheet edge set at once:
 *
 * 1. Resolve which `resource_items` rows are classified `'css'`
 *    (`content_type_refs.category`) and their stylesheet URL.
 * 2. Resolve `resource_ref_edges` for just those CSS resource ids, in
 *    chunks, projecting only the two integer ids per row.
 * @param accessor - The archive accessor to read from.
 * @returns Map from `page_id` to the stylesheet URLs it references. Pages
 *   that reference no CSS resource have no entry — callers should default to
 *   an empty array on a missed lookup.
 * @example
 * ```ts
 * const stylesheetsByPageId = await collectPageStylesheetUrlsByPageId(accessor);
 * const hrefs = stylesheetsByPageId.get(pageId) ?? [];
 * ```
 */
export async function collectPageStylesheetUrlsByPageId(
	accessor: ArchiveAccessor,
): Promise<Map<number, readonly string[]>> {
	const knex = accessor.getKnex();

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

	const internedSets = new Map<string, readonly string[]>();
	const result = new Map<number, readonly string[]>();
	for (const [pageId, resourceIds] of resourceIdsByPageId) {
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
		result.set(pageId, interned);
	}

	return result;
}
