/* eslint-disable unicorn/prefer-code-point --
 * This file deliberately uses `charCodeAt` (UTF-16 code units) rather
 * than `codePointAt` (Unicode code points). The natural-sort algorithm
 * is byte-level by definition in Pool's reference C implementation,
 * and advancing the index by one per call only works when each call
 * returns one unit. Mixing in `codePointAt` would force separate
 * surrogate-pair handling for negligible benefit (URLs are
 * effectively ASCII at the sort layer).
 */

/**
 * ASCII character codes used by {@link naturalCompare}. Computed once
 * via `charCodeAt` so `'Z'` reads more naturally than `0x5A`.
 */
const CHAR_NUL = 0;
const CHAR_TAB = '\t'.charCodeAt(0);
const CHAR_CR = '\r'.charCodeAt(0);
const CHAR_SPACE = ' '.charCodeAt(0);
const CHAR_ZERO = '0'.charCodeAt(0);
const CHAR_NINE = '9'.charCodeAt(0);
const CHAR_UPPER_A = 'A'.charCodeAt(0);
const CHAR_UPPER_Z = 'Z'.charCodeAt(0);
const ASCII_CASE_SHIFT = 'a'.charCodeAt(0) - 'A'.charCodeAt(0);

/**
 * Returns the UTF-16 code unit at `i`, or 0 (NUL) when out of range.
 * Mimics how Pool's C reference treats the implicit `'\0'` terminator
 * — JavaScript strings have no terminator, so we synthesize one.
 * @param s - The string being scanned.
 * @param i - Zero-based index.
 */
function codeAtOrNul(s: string, i: number): number {
	return i < s.length ? s.charCodeAt(i) : CHAR_NUL;
}

/**
 * Matches Pool's `nat_isspace`: ASCII whitespace (`\t`, `\n`, `\v`,
 * `\f`, `\r`, ` `). Codes 9..13 are contiguous in ASCII so a single
 * range covers `\t \n \v \f \r`.
 * @param c - UTF-16 code unit.
 */
function isAsciiWhitespace(c: number): boolean {
	return c === CHAR_SPACE || (c >= CHAR_TAB && c <= CHAR_CR);
}

/**
 * Matches Pool's `nat_isdigit`: ASCII `'0'..'9'`.
 * @param c - UTF-16 code unit.
 */
function isAsciiDigit(c: number): boolean {
	return c >= CHAR_ZERO && c <= CHAR_NINE;
}

/**
 * Pool's `compare_right` — used when no leading zero is present in
 * either run. Walks both digit runs to their end. The first side to
 * exhaust its digit run is the smaller number. If both runs end at
 * the same time, the bias (first non-equal digit seen) decides.
 *
 * Returns 0 only when both runs end simultaneously with no bias —
 * i.e. the two runs encode the same integer.
 * @param a - First string.
 * @param ai - Start index in `a` (pointing at the first digit).
 * @param b - Second string.
 * @param bi - Start index in `b` (pointing at the first digit).
 */
function compareRight(a: string, ai: number, b: string, bi: number): number {
	let bias = 0;
	for (;;) {
		const ca = codeAtOrNul(a, ai);
		const cb = codeAtOrNul(b, bi);
		const aDigit = isAsciiDigit(ca);
		const bDigit = isAsciiDigit(cb);
		if (!aDigit && !bDigit) return bias;
		if (!aDigit) return -1;
		if (!bDigit) return 1;
		if (bias === 0) {
			if (ca < cb) bias = -1;
			else if (ca > cb) bias = 1;
		}
		ai++;
		bi++;
	}
}

/**
 * Pool's `compare_left` — used when **either** run starts with a
 * `'0'`, treating both runs as the fractional part of a decimal
 * (e.g. `"01"` < `"1"` because `0.01 < 0.1`). Compares left-aligned
 * digit-by-digit and returns at the first mismatch.
 *
 * Returns 0 only when both runs are identical character-by-character
 * up to their end.
 * @param a - First string.
 * @param ai - Start index in `a` (pointing at the first digit).
 * @param b - Second string.
 * @param bi - Start index in `b` (pointing at the first digit).
 */
function compareLeft(a: string, ai: number, b: string, bi: number): number {
	for (;;) {
		const ca = codeAtOrNul(a, ai);
		const cb = codeAtOrNul(b, bi);
		const aDigit = isAsciiDigit(ca);
		const bDigit = isAsciiDigit(cb);
		if (!aDigit && !bDigit) return 0;
		if (!aDigit) return -1;
		if (!bDigit) return 1;
		if (ca < cb) return -1;
		if (ca > cb) return 1;
		ai++;
		bi++;
	}
}

/**
 * Natural-order string comparator, ported from Martin Pool's
 * `strnatcmp.c` (sourcefrog/natsort, originally derived from Stuart
 * Cheshire's 1996 Macintosh natural sort). Faithful to the C
 * reference's dispatch:
 *
 * - Skip leading ASCII whitespace on both sides.
 * - When both sides have a digit run:
 *   - If **either** run starts with `'0'`, treat them as fractional
 *     and use {@link compareLeft} (left-aligned digit-by-digit).
 *   - Otherwise use {@link compareRight} (length-first, with bias for
 *     ties).
 * - End-of-string on both sides means equal.
 * - Otherwise fold ASCII letters to lower case and compare one
 *   UTF-16 code unit.
 *
 * Allocates no intermediate strings: only `charCodeAt` and integer
 * arithmetic. That makes the function safe to invoke O(N log N)
 * times during a 1M+ element sort without inflating the V8 heap with
 * derived `SeqString` allocations.
 *
 * **Benchmark reference (Node 24, M-class CPU):** 100K-entry sort
 * completes in ~650 ms with median heap delta ratio
 * `heapDelta(100K) / heapDelta(10K) ≈ 5–15×`. If either measurement
 * jumps by an order of magnitude (multi-second elapsed, ratio > 100),
 * suspect a regression that reintroduced per-compare string
 * allocation or `Intl.Collator` dispatch.
 *
 * **UTF-16 semantics:** index moves one code unit per step. ASCII
 * URLs (the only kind the archive currently stores) are entirely
 * BMP, so this is equivalent to per-character iteration. URLs that
 * contain surrogate pairs (e.g. raw emoji in path segments) compare
 * as UTF-16 code unit sequences, which is deterministic but not
 * equivalent to Unicode code-point order. That matches `strnatcmp.c`
 * — it also operates on bytes, not Unicode scalars.
 * @param a - First URL.
 * @param b - Second URL.
 * @returns Negative if `a < b`, positive if `a > b`, zero if equal.
 */
export function naturalCompare(a: string, b: string): number {
	let ai = 0;
	let bi = 0;

	for (;;) {
		let ca = codeAtOrNul(a, ai);
		let cb = codeAtOrNul(b, bi);

		while (isAsciiWhitespace(ca)) {
			ai++;
			ca = codeAtOrNul(a, ai);
		}
		while (isAsciiWhitespace(cb)) {
			bi++;
			cb = codeAtOrNul(b, bi);
		}

		if (isAsciiDigit(ca) && isAsciiDigit(cb)) {
			const fractional = ca === CHAR_ZERO || cb === CHAR_ZERO;
			const result = fractional ? compareLeft(a, ai, b, bi) : compareRight(a, ai, b, bi);
			if (result !== 0) return result;
			// Both digit-run helpers return 0 only when the digit
			// runs are pointwise equal up to their joint end. Fall
			// through and let the trailing byte compare advance
			// past the shared first digit, exactly like Pool's C
			// source.
		}

		if (ca === CHAR_NUL && cb === CHAR_NUL) {
			return 0;
		}

		const fa = ca >= CHAR_UPPER_A && ca <= CHAR_UPPER_Z ? ca + ASCII_CASE_SHIFT : ca;
		const fb = cb >= CHAR_UPPER_A && cb <= CHAR_UPPER_Z ? cb + ASCII_CASE_SHIFT : cb;
		if (fa < fb) return -1;
		if (fa > fb) return 1;

		ai++;
		bi++;
	}
}

/**
 * Sorts archive resources by their URL in natural order, returning a
 * new array (the input is left untouched). Uses
 * {@link naturalCompare} as the comparator, so embedded integers
 * compare by value (`image-2.jpg` < `image-10.jpg`) and ASCII case
 * is folded.
 *
 * The sort is stable (V8 TimSort). Each comparison allocates no
 * intermediate strings, so the only extra memory is V8's TimSort
 * auxiliary buffer — O(N) pointer-sized entries, not O(N × URL length).
 * @param resources - The list of resources to sort. Only the `url`
 *   field is read.
 * @returns A new array sorted by URL in natural order.
 * @example
 * ```ts
 * sortResourcesByUrl([
 *   { url: 'https://x/img-10.jpg' },
 *   { url: 'https://x/img-2.jpg' },
 *   { url: 'https://x/img-1.jpg' },
 * ]);
 * // → [{ url: 'https://x/img-1.jpg' }, { url: 'https://x/img-2.jpg' }, { url: 'https://x/img-10.jpg' }]
 * ```
 */
export function sortResourcesByUrl<T extends { readonly url: string }>(
	resources: readonly T[],
): T[] {
	return resources.toSorted((a, b) => naturalCompare(a.url, b.url));
}
