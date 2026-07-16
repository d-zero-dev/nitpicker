import type { PageData } from '../../../../utils/types/types.js';
import type { PageSource } from '../../../types.js';
import type { WriteRefCaches } from '../../_shared/types.js';
import type { Knex } from 'knex';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';

import { dbLog } from '../../../debug.js';
import { deriveLineageFromParent } from '../../../derive-lineage-from-parent.js';
import { resolveRedirectChain } from '../../../resolve-redirect-chain.js';
import { clearWriteRefCaches } from '../../_shared/clear-write-ref-caches.js';
import { resolveContentItemId } from '../../_shared/resolve-content-item-id.js';

import { linkRedirectSources } from './link-redirect-sources.js';

/**
 * Records a redirect edge (source → destination) **without** re-storing the
 * destination's content.
 *
 * The crawler renders a many-to-one redirect destination exactly once. For
 * every subsequent source URL that redirects to that already-rendered
 * destination, it calls this instead of {@link ./update-page.ts} (#73).
 * Routing a content-less HEAD result through `updatePage` would funnel it
 * into `insertPage` and overwrite the destination's good title / meta with
 * empty values, so the dedicated edge-only path is required.
 *
 * The destination row is resolved (created on demand if a concurrent
 * in-flight render has not committed it yet) so the edge always points at a
 * valid id; the single render fills in the destination's content under that
 * same id. The destination's existing anchors / images are never touched
 * here.
 * @param knex - Knex query builder connected to the archive DB.
 * @param caches - The connection's write-side id caches.
 * @param page - HEAD-resolved page data carrying the redirect chain. Its
 *   `anchorList` / `imageList` are ignored (a redirect source owns no content).
 * @param source - Inventory provenance forwarded by the orchestrator
 *   (`Archive.setRedirect` → here) for the redirect-edge fast path. Used
 *   as the fallback when the originating URL's row does NOT yet exist in
 *   the archive (`#73` convergence on first sight, js-redirect rescue
 *   before any prior write). When the originating row already exists
 *   (e.g. anchor-lineage INSERT from a prior pass), its stored `source`
 *   takes precedence so transitive lineage is preserved across resume /
 *   retry-failed sessions. `undefined` keeps the DB DEFAULT `'crawled'`
 *   on a brand-new destination row.
 */
export async function recordRedirect(
	knex: Knex,
	caches: WriteRefCaches,
	page: PageData,
	source?: PageSource,
): Promise<void> {
	const { destUrl, sources } = resolveRedirectChain(
		page.url.withoutHashAndAuth,
		page.redirectPaths,
	);

	// No redirect chain (the URL is itself the already-rendered destination,
	// reached both directly and via a redirect) → there is no edge to write.
	// Returning here avoids opening a transaction and, crucially, avoids
	// `resolveContentItemId` inserting a content-less placeholder row for a
	// destination that may not have been written yet.
	if (sources.length === 0) {
		return;
	}

	const destUrlObject = parseUrl(destUrl);

	if (!destUrlObject) {
		// A malformed redirect target should not abort the whole crawl (this
		// runs inside the WriteQueue, whose rejection aborts the run). Recording
		// a single redirect edge is best-effort, so skip it and move on. Unlike
		// `updatePage`, there is no page content at stake here.
		dbLog('recordRedirect: skip malformed destination URL: %s', destUrl);
		return;
	}

	try {
		await knex.transaction(async (trx) => {
			// Pass the caller-supplied `source` straight through so a brand-new
			// destination row INSERTed here picks up the inventory lineage
			// (instead of the DB DEFAULT `'crawled'`) when the caller is in the
			// inventory chain — without the pass-through, inventory lineage
			// would be laundered to `'crawled'` for js-redirect rescue / #73
			// convergence destinations that have not yet been rendered.
			const destId = await resolveContentItemId(
				trx,
				caches,
				destUrlObject.withoutHashAndAuth,
				undefined,
				source,
			);
			// Chain lineage propagates FROM the originating URL (`page.url`),
			// NOT from the destination. The originating URL is what initiated
			// the redirect chain, so its lineage is what every intermediate hop
			// transitively inherits. Reading from the destination would
			// mis-propagate in "inventory-seed → ... → existing crawled dest"
			// chains: the intermediates are reached only via the inventory
			// chain, so they belong to the inventory chain even though the
			// chain happens to land on a crawled URL. The `'crawled'` fallback
			// arms the crawled-wins downgrade for existing `'inventory-*'`
			// intermediates that a crawled chain reaches.
			const cachedOriginating = caches.contentItems.get(page.url.withoutHashAndAuth);
			let originatingSource: PageSource | undefined = cachedOriginating?.source;
			if (originatingSource === undefined) {
				const [originatingRow] = (await trx
					.select('ci.source')
					.from('content_items as ci')
					.join('url_refs as ur', 'ur.id', 'ci.url_id')
					.where('ur.url', page.url.withoutHashAndAuth)) as { source: PageSource }[];
				originatingSource = originatingRow?.source ?? source;
			}
			const chainLineageSource = deriveLineageFromParent(originatingSource, 'crawled');
			await linkRedirectSources(
				trx,
				caches,
				sources,
				destId,
				destUrlObject.withoutHashAndAuth,
				page.isExternal,
				chainLineageSource,
			);
		});
	} catch (error) {
		// A rolled-back transaction can leave ids cached that no longer
		// correspond to any row (AUTOINCREMENT never rewinds) — see
		// `clearWriteRefCaches` for why a full clear, not a partial one, is
		// required. `emitErrorAndRetry` may retry this whole call, so the
		// cache must be clean before the next attempt (same guard as
		// `updatePage`).
		clearWriteRefCaches(caches);
		throw error;
	}
}
