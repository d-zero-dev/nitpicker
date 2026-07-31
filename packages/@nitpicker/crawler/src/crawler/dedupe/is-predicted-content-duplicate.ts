/**
 * Determines whether a predicted URL's rendered body is a byte-for-byte
 * duplicate of the previous predicted page generated for the same URL shape.
 *
 * The comparison is deliberately against the previous *predicted* page, not
 * the origin (real) page the pattern was detected from: a real listing
 * page's body legitimately differs from an empty/placeholder predicted
 * page's body regardless of whether the site is a trap, so comparing
 * against the origin would never fire. Two consecutive predicted pages of
 * the same shape rendering identical bodies is direct evidence the site
 * ignores the extrapolated token entirely (e.g. an out-of-range
 * `/news/date/{n}/` always serves the same "no results" template).
 * @param bodyHash - The `computeBodyHash` result for the predicted page just scraped.
 * @param lastBodyHash - The previous predicted page's body hash for the same
 *   shape, or `null` if this is the first predicted page seen for the shape.
 * @returns `true` when both hashes exist and are byte-identical.
 * @example
 * ```ts
 * isPredictedContentDuplicate(Buffer.from('a'), null); // false — no prior hash yet
 * isPredictedContentDuplicate(Buffer.from('a'), Buffer.from('a')); // true
 * isPredictedContentDuplicate(Buffer.from('a'), Buffer.from('b')); // false
 * ```
 */
export function isPredictedContentDuplicate(
	bodyHash: Buffer,
	lastBodyHash: Buffer | null,
): boolean {
	return lastBodyHash !== null && bodyHash.equals(lastBodyHash);
}
