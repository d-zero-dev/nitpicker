import type { DedupeCapObservation } from './types.js';
import type { DedupeCapObservationRow } from '../../archive/types.js';

import { computeMetaSignature } from './compute-meta-signature.js';
import { computeShapeKey } from './compute-shape-key.js';
import { resolveOgUrlMismatch } from './resolve-og-url-mismatch.js';

/**
 * Reconstructs the `DedupeCapObservation` a previously-scraped page would
 * have produced had it been observed live, from the archived
 * `DedupeCapObservationRow` `listDedupeCapObservations` reads back out of
 * `content_items` / `page_meta`. Used to replay a prior session's
 * observations into a fresh `DedupeCapTracker` on `--resume` / `--append` /
 * `--retry-failed` / `--inventory` / `--recrawl`, so the Misra-Gries
 * counters those sessions accumulate are not silently discarded — only the
 * confirmed-capped shapes (`DedupeCapTracker`'s sticky set) survive a
 * process restart otherwise, and a shape that was close to (but short of)
 * its threshold when the previous session ended would restart at count 0.
 *
 * Mirrors the exact exclusions the live crawl-time observation site applies
 * (`Crawler`'s `'page'` handler, gated on `!isExternal && !isMetadataOnly &&
 * html.length > 0`): `listDedupeCapObservations` already narrows to that
 * same population at the SQL layer, so this function only needs to redo
 * the two per-row signal computations that can independently yield "no
 * signal" — `computeShapeKey` (a URL that fails to decompose) and
 * `computeMetaSignature` (no title and no Open Graph tags) — and return
 * `null` exactly where the live site would have skipped the page.
 *
 * **Known limitation — `og:url` absolutisation drift**: `computeMetaSignature`
 * deliberately hashes `og:url` *as written* (no absolutisation — see its own
 * JSDoc), but `page_meta.og_url_id` only ever stores the *absolutised* form
 * (`derive-flat-from-meta.ts`'s `og_url: absolutizeUrl(og?.url, base)`) — the
 * archive never keeps the raw, possibly-relative string. For a page whose
 * template writes `og:url` as an absolute URL (the OGP-recommended, and most
 * common, form) this is a no-op and the reconstructed `metaSig` matches the
 * live one exactly. For a template that writes it relative, the replayed
 * `metaSig` for that shape's already-archived members will not bit-for-bit
 * match the `metaSig` a *newly*-scraped same-shape page computes live this
 * session (e.g. a previously-failed page succeeding under `--retry-failed`),
 * so the Misra-Gries counter may fail to recognise it as a repeat of the
 * dominant signature. This can only cause under-counting (a missed majority
 * match, decrementing instead of incrementing), never over-counting — a
 * `metaSig` mismatch can never falsely trigger a cap — so it degrades this
 * feature's benefit for relative-`og:url` sites without ever making the cap
 * fire incorrectly.
 *
 * **Known limitation — hash-fragment drift in `ogUrlMismatch`**: the live
 * call site (`Crawler`'s `'page'` handler) resolves `og:url` against
 * `result.pageData.url.href` — the page's full URL, hash fragment included
 * — while `listDedupeCapObservations` reads back `url_refs.url`, which is
 * always stored as `withoutHashAndAuth` (see `insert-page.ts`); the archive
 * never keeps the hash. For a page whose own URL carries a `#fragment` and
 * whose `og:url` resolves to that same URL *without* the fragment (a
 * correct, common self-reference), the live computation sees a mismatch
 * (the fragment differs) while the replayed one — comparing two
 * fragment-less strings — does not. Same failure direction as the
 * `metaSig` limitation above: this can only suppress a mismatch replay
 * would otherwise have detected, never fabricate one, so it degrades this
 * signal's confidence-halving benefit for hash-carrying pages without ever
 * making the cap fire incorrectly. `bodyHash` and the reconstructed `url`
 * field are unaffected by this — only the `pageUrl` argument to
 * `resolveOgUrlMismatch` is hash-stripped.
 * @param row - One archived page's fields, from `listDedupeCapObservations`.
 * @returns The reconstructed observation, or `null` if the row carries no
 *   usable shape or meta signal (mirroring the live site's skip condition).
 * @example
 * ```ts
 * buildDedupeCapObservation({
 * 	url: 'https://example.com/news/date/2024/',
 * 	title: 'お知らせ',
 * 	description: null,
 * 	ogTitle: null,
 * 	ogUrl: null,
 * 	bodyHash: Buffer.from('...'),
 * });
 * // => { shapeKey: 'example.com/news/date/{n}/', metaSig: '...', bodyHash, ogUrlMismatch: false, url: 'https://example.com/news/date/2024/' }
 * ```
 */
export function buildDedupeCapObservation(
	row: DedupeCapObservationRow,
): DedupeCapObservation | null {
	const shapeKey = computeShapeKey(row.url);
	if (!shapeKey) return null;

	const meta = {
		title: row.title ?? '',
		description: row.description ?? undefined,
		og: {
			title: row.ogTitle ?? undefined,
			url: row.ogUrl ?? undefined,
		},
	};
	const metaSig = computeMetaSignature(meta);
	if (!metaSig) return null;

	return {
		shapeKey,
		metaSig,
		bodyHash: row.bodyHash,
		ogUrlMismatch: resolveOgUrlMismatch(meta, row.url),
		url: row.url,
	};
}
