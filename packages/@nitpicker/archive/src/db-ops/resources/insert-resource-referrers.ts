import type { WriteRefCaches } from '../_shared/types.js';
import type { Knex } from 'knex';

import { resolveContentItemId } from '../_shared/resolve-content-item-id.js';

/**
 * Inserts a referrer relationship between a resource and a page into the
 * `resource_ref_edges` table. Silently skips if the resource is not found.
 *
 * A repeat observation of the same `(resource, page)` pair is ignored
 * (`ON CONFLICT ... IGNORE`), leaving `count` at its DEFAULT `1` — one
 * row per pair, matching the legacy uniqueness contract.
 * @param knex - Knex query builder connected to the archive DB.
 * @param caches - The connection's write-side id caches.
 * @param src - The URL of the resource.
 * @param pageUrl - The URL of the page that references the resource.
 */
export async function insertResourceReferrers(
	knex: Knex,
	caches: WriteRefCaches,
	src: string,
	pageUrl: string,
): Promise<void> {
	const resourceId = await findResourceIdByUrl(knex, caches, src);
	if (resourceId === undefined) {
		// Ignore when the resource is not found
		return;
	}
	const pageId = await resolveContentItemId(knex, caches, pageUrl);
	await knex('resource_ref_edges')
		.insert({
			resource_id: resourceId,
			page_id: pageId,
		})
		.onConflict(['resource_id', 'page_id'])
		.ignore();
}

/**
 * Cache-first lookup of `resource_items.id` by the resource URL. The
 * cache only ever gains entries for URLs that exist in the table
 * (resource identities are never deleted during a crawl), so a hit is
 * always valid; a miss falls through to a `url_refs` join.
 * @param knex - Knex query builder.
 * @param caches - The connection's write-side id caches.
 * @param url - The resource URL, verbatim as stored.
 * @returns The resource id, or `undefined` when the URL is unknown.
 */
async function findResourceIdByUrl(
	knex: Knex,
	caches: WriteRefCaches,
	url: string,
): Promise<number | undefined> {
	const cached = caches.resourceIds.get(url);
	if (cached !== undefined) {
		return cached;
	}
	const [row] = (await knex
		.select('ri.id')
		.from('resource_items as ri')
		.join('url_refs as ur', 'ur.id', 'ri.url_id')
		.where('ur.url', url)) as { id: number }[];
	if (row === undefined) {
		return undefined;
	}
	caches.resourceIds.set(url, row.id);
	return row.id;
}
