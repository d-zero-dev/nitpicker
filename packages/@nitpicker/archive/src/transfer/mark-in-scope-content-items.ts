import type { ExURL, ParseURLOptions } from '@d-zero/shared/parse-url';
import type { Knex } from 'knex';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';

import { findScopeEntry } from '../scope/find-scope-entry.js';

import { TRANSFER_SOURCE_ALIAS } from './transfer-source-alias.js';

/** Row shape read from the source's internal `content_items`/`url_refs`. */
interface CandidateRow {
	id: number;
	url: string;
}

/**
 * Determines which of the source's internal (`is_external = 0`)
 * `content_items` rows fall inside `scope` (split's new, narrower root
 * set), writing matching ids into `temp.xfer_ci_in_scope`.
 *
 * Mirrors `repromoteExternalPages`'s shape (load every candidate URL into
 * memory, classify with {@link findScopeEntry} in JS, write matches back
 * in bound-count-safe chunks) — the same accepted pattern for a one-off,
 * whole-archive scope reclassification. External rows are never
 * candidates here: split's scope check only ever needs to know "was this
 * an internal page that is now out of scope", since the "external
 * everywhere but in scope" case is a concat-only concept (split has a
 * single source, so there is nothing to promote).
 * @param trx - Transaction with the source ATTACHed as
 *   {@link TRANSFER_SOURCE_ALIAS}. Must run after
 *   {@link import('./create-transfer-temp-tables.js').createTransferTempTables}.
 * @param scope - The new (narrower) scope map, from
 *   {@link import('../scope/build-scope-map.js').buildScopeMap} over
 *   the split's scope URLs.
 * @param options - URL parsing options forwarded to {@link findScopeEntry}
 *   (the source archive's own `disableQueries`, typically).
 * @returns The number of ids written to `temp.xfer_ci_in_scope`.
 * @example
 * ```ts
 * const scope = buildScopeMap(['https://example.com/blog/']);
 * const inScopeCount = await markInScopeContentItems(trx, scope, sourceConfig);
 * ```
 */
export async function markInScopeContentItems(
	trx: Knex,
	scope: ReadonlyMap<string, readonly ExURL[]>,
	options?: ParseURLOptions,
): Promise<number> {
	const candidates: CandidateRow[] = await trx
		.select(`${TRANSFER_SOURCE_ALIAS}.content_items.id as id`, 'url_refs.url as url')
		.from(`${TRANSFER_SOURCE_ALIAS}.content_items`)
		.join(
			{ url_refs: `${TRANSFER_SOURCE_ALIAS}.url_refs` },
			'url_refs.id',
			`${TRANSFER_SOURCE_ALIAS}.content_items.url_id`,
		)
		.where(`${TRANSFER_SOURCE_ALIAS}.content_items.is_external`, 0);

	const inScopeIds: number[] = [];
	for (const row of candidates) {
		const parsed = parseUrl(row.url, options);
		if (!parsed) {
			continue;
		}
		if (findScopeEntry(parsed, scope, options) !== null) {
			inScopeIds.push(row.id);
		}
	}

	const chunkSize = 500;
	for (let i = 0; i < inScopeIds.length; i += chunkSize) {
		const chunk = inScopeIds.slice(i, i + chunkSize);
		await trx.insert(chunk.map((id) => ({ src_id: id }))).into('xfer_ci_in_scope');
	}
	return inScopeIds.length;
}
