import type { ExURL, ParseURLOptions } from '@d-zero/shared/parse-url';
import type { Knex } from 'knex';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';

import { findScopeEntry } from '../scope/find-scope-entry.js';

/**
 * Recomputes `resource_items.is_external` for the WHOLE destination
 * archive against its final (merged or narrowed) scope, once every source
 * has been transferred.
 *
 * Unlike `content_items.is_external` ("was this taken on as a crawl
 * target" — a write-time fact this transfer never re-derives, per
 * ARCHITECTURE.md's invariant), `resource_items.is_external` is a pure
 * scope check computed the same way at crawl time
 * (`@nitpicker/crawler`'s `Crawler#handleResources`: `findScopeEntry(url, this.#scope)
 * === null`). Concat's merged scope is a union of every source's roots,
 * so a resource one source recorded as external can legitimately become
 * internal-by-scope in the output even though nothing about the resource
 * itself changed — recomputing this is the resource-table equivalent of
 * what `content_items` deliberately does NOT do, and the two must not be
 * "unified" into the same rule.
 *
 * Mirrors `repromoteExternalPages`'s shape (load every resource's URL,
 * classify in JS, write matches back in bound-safe chunks) rather than a
 * single SQL scope join — `resource_items.url_id` is nullable
 * (`url_blob_id` rows have no URL to classify and are left as recorded),
 * so the candidate set is every resource with a non-null `url_id`.
 * @param trx - The destination transaction (no source ATTACHed).
 * @param scope - The output archive's final scope map
 *   (`buildScopeMap(mergedOrNarrowedRoots, config)`).
 * @param options - URL parsing options forwarded to {@link findScopeEntry}
 *   (the output archive's own `disableQueries`).
 * @returns The number of resources whose `is_external` flipped.
 * @example
 * ```ts
 * const scope = buildScopeMap(config.roots, config);
 * const flipped = await reclassifyResourceExternality(knex, scope, config);
 * ```
 */
export async function reclassifyResourceExternality(
	trx: Knex,
	scope: ReadonlyMap<string, readonly ExURL[]>,
	options?: ParseURLOptions,
): Promise<number> {
	const candidates: { id: number; url: string; is_external: number }[] = await trx
		.select(
			'resource_items.id as id',
			'url_refs.url as url',
			'resource_items.is_external',
		)
		.from('resource_items')
		.join('url_refs', 'url_refs.id', 'resource_items.url_id');

	const toInternal: number[] = [];
	const toExternal: number[] = [];
	for (const row of candidates) {
		const parsed = parseUrl(row.url, options);
		const isExternal = parsed ? findScopeEntry(parsed, scope, options) === null : true;
		if (isExternal && row.is_external === 0) {
			toExternal.push(row.id);
		} else if (!isExternal && row.is_external === 1) {
			toInternal.push(row.id);
		}
	}

	const chunkSize = 500;
	for (const [ids, value] of [
		[toInternal, 0],
		[toExternal, 1],
	] as const) {
		for (let i = 0; i < ids.length; i += chunkSize) {
			await trx('resource_items')
				.whereIn('id', ids.slice(i, i + chunkSize))
				.update({ is_external: value });
		}
	}
	return toInternal.length + toExternal.length;
}
