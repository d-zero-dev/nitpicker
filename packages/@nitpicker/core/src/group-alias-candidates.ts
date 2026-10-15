import type { AliasCandidate } from './types.js';

import { assertU32Id } from './assert-u32-id.js';
import { nativeBinding } from './native-binding.js';

/** The native call addresses the bytes with `u32` offsets. */
const MAX_BYTES = 4_294_967_295;

/** The index of a candidate returned as `-1` must fit an `Int32Array`. */
const MAX_CANDIDATES = 2_147_483_647;

/** The addon's "none" for a canonical id. */
const NO_CANONICAL = 4_294_967_295;

/**
 * Groups the pages that are the same page under another URL, and elects each
 * group's representative.
 *
 * Two candidates are in one group when a chain of the following links them:
 *
 * - **Tier A**: the same title and the same Tier A key (`computeAliasKeys`);
 * - **Tier B**: the same title, the same Tier B key **and** the same body
 *   hash (a candidate without a body hash is not grouped this way).
 *
 * A URL that gives no key is not grouped by it. Each tier alone is an
 * equivalence but their union is not, so the groups are the connected
 * components of both.
 *
 * The representative of a group of two or more is elected in turn by: the
 * most `<link rel="canonical">` declarations **within the group** pointing at
 * its URL (when no member is pointed at, every member stays in the running);
 * the shortest URL in UTF-16 code units; the smallest URL by UTF-16 code unit
 * order. URLs are distinct, so the result does not depend on the order of the
 * candidates.
 *
 * Only the columns cross to the addon, and the grouping runs there.
 * @param candidates - The pages. `urlId` is `url_refs.id`: two candidates
 *   have the same URL exactly when they have the same id.
 * @returns For each candidate, the index of its group's representative, or
 *   `-1` for a representative and for a candidate in a group of one.
 * @throws {RangeError} When an id is not an integer in `0..=4294967294`, or
 *   the URLs or hashes are too many bytes for the call to address.
 * @example
 * ```ts
 * const page = { titleTextId: 1, canonicalUrlId: null, bodyHash: null };
 * groupAliasCandidates([
 * 	{ ...page, url: 'https://example.com/about/index.html', urlId: 1 },
 * 	{ ...page, url: 'https://example.com/about/', urlId: 2 },
 * 	{ ...page, url: 'https://example.com/contact/', urlId: 3 },
 * ]); // Int32Array [1, -1, -1]: the shortest URL is the representative
 * ```
 */
export function groupAliasCandidates(candidates: readonly AliasCandidate[]): Int32Array {
	const count = candidates.length;
	if (count > MAX_CANDIDATES) {
		throw new RangeError(`More than ${MAX_CANDIDATES} candidates`);
	}

	// Sized exactly, so the buffers are no bigger than what crosses to the addon.
	let urlBytes = 0;
	let hashBytes = 0;
	for (const candidate of candidates) {
		urlBytes += Buffer.byteLength(candidate.url, 'utf8');
		hashBytes += candidate.bodyHash?.length ?? 0;
	}
	if (urlBytes > MAX_BYTES) {
		throw new RangeError(`The URLs take more than ${MAX_BYTES} bytes`);
	}
	if (hashBytes > MAX_BYTES) {
		throw new RangeError(`The body hashes take more than ${MAX_BYTES} bytes`);
	}
	const urls = Buffer.allocUnsafe(urlBytes);
	const urlOffsets = new Uint32Array(count + 1);
	const bodyHashes = new Uint8Array(hashBytes);
	const hashOffsets = new Uint32Array(count + 1);
	const hashPresent = new Uint8Array(count);
	const urlIds = new Uint32Array(count);
	const titleTextIds = new Uint32Array(count);
	const canonicalUrlIds = new Uint32Array(count);
	let urlTotal = 0;
	let hashTotal = 0;
	for (const [index, candidate] of candidates.entries()) {
		urlTotal += urls.write(candidate.url, urlTotal, 'utf8');
		urlOffsets[index + 1] = urlTotal;
		if (candidate.bodyHash) {
			bodyHashes.set(candidate.bodyHash, hashTotal);
			hashTotal += candidate.bodyHash.length;
			hashPresent[index] = 1;
		}
		hashOffsets[index + 1] = hashTotal;
		urlIds[index] = assertU32Id(candidate.urlId, 'url id');
		titleTextIds[index] = assertU32Id(candidate.titleTextId, 'title text id');
		canonicalUrlIds[index] =
			candidate.canonicalUrlId === null
				? NO_CANONICAL
				: assertU32Id(candidate.canonicalUrlId, 'canonical url id');
	}

	const representatives = nativeBinding.groupAliasCandidates({
		urls,
		urlOffsets,
		urlIds,
		titleTextIds,
		canonicalUrlIds,
		bodyHashes,
		hashOffsets,
		hashPresent,
	});
	// Indexes are below 2**31, so reading the same bytes as signed turns the
	// addon's `4294967295` "none" into `-1` without a copy.
	return new Int32Array(
		representatives.buffer,
		representatives.byteOffset,
		representatives.length,
	);
}
