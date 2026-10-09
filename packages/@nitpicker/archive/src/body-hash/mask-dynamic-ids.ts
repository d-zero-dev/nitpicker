const DYNAMIC_ID_PATTERN = /[a-z0-9]{8,}/gi;
const DIGITS_ONLY_PATTERN = /^\d+$/;
const ALPHA_ONLY_PATTERN = /^[a-z]+$/i;
const MASK_PLACEHOLDER = '__MASKED_ID__';

/**
 * Replaces mixed-alphanumeric tokens of 8+ characters with a fixed
 * placeholder, so that two bodies differing only in an embedded dynamic
 * value (a cache-busting hash, a per-build CSS-module suffix, a session or
 * order id) hash the same.
 *
 * A token is masked only when it mixes letters and digits — a pure-digit
 * match (phone numbers, product codes, dates) or a pure-alphabetic match (an
 * ordinary English word) is left untouched, since those are far more likely
 * to be stable content than a dynamic identifier.
 *
 * This is a heuristic, not a semantic classifier, and it is accepted as such:
 * a mixed-alphanumeric SKU/order/product code that is itself the only
 * distinguishing content between two otherwise-identical pages (e.g.
 * `ABC12345` vs `XYZ98765`) also gets masked, collapsing two genuinely
 * different pages into one `computeBodyHash` duplicate-detection group — a
 * false positive. Narrowing the pattern to reduce that risk would also
 * narrow what it catches (the whole point of this mask is to absorb
 * cache-busting hashes and CSS-module suffixes whose shape is
 * indistinguishable from such a code), so this trade-off is deliberate
 * rather than something a stricter regex would cleanly resolve.
 *
 * The placeholder is a fixed constant rather than a per-match incrementing
 * id: nothing needs to reverse the substitution back to the original value —
 * the full original HTML is already preserved verbatim in `page_html_blobs`,
 * so recovering it here would be redundant. All that matters for duplicate
 * detection is that every masked token collapses to the same value.
 * @param text - Text to mask (already URL-normalized by
 *   `normalizeUrlLikeStrings`).
 * @returns `text` with every mixed-alphanumeric 8+ character token replaced
 *   by a fixed placeholder.
 */
export function maskDynamicIds(text: string): string {
	return text.replaceAll(DYNAMIC_ID_PATTERN, (match) => {
		if (DIGITS_ONLY_PATTERN.test(match) || ALPHA_ONLY_PATTERN.test(match)) {
			return match;
		}
		return MASK_PLACEHOLDER;
	});
}
