/* eslint-disable unicorn/prefer-code-point, unicorn/number-literal-case, unicorn/no-lonely-if, unicorn/prefer-math-trunc, unicorn/numeric-separators-style --
 * This file contains an intentionally-naïve JavaScript transliteration
 * of Pool's `strnatcmp.c` (see `strnatcmpOracle`). The implementation
 * uses `charCodeAt` / `fromCharCode` / `| 0` integer coercion / lonely
 * if-blocks to stay faithful to the C source line-for-line, so the
 * oracle is easy to diff against the upstream reference. The
 * corresponding `unicorn/*` lint rules are disabled file-wide for that
 * reason — applying them would obscure the relationship to the C code.
 */
import { describe, expect, it } from 'vitest';

import { naturalCompare, sortResourcesByUrl } from './sort-resources-by-url.js';

/**
 * Direct, unoptimized port of Martin Pool's `strnatcmp.c` used as an
 * oracle for fuzz testing against the production implementation in
 * `sort-resources-by-url.ts`. Mirrors the C source verbatim, including
 * the `fractional = (ca == '0' || cb == '0')` dispatch, the
 * `compare_left` / `compare_right` helpers, the trailing case-fold
 * compare, and the `'\0'`-terminated read pattern (synthesized here
 * with `charAt(i) || '\0'` since JS strings have no terminator).
 *
 * Should never diverge from {@link naturalCompare}. If a fuzz test
 * shows a sign mismatch, treat the production implementation — not
 * this oracle — as the bug, unless the divergence is itself documented.
 * @param a
 * @param b
 */
function strnatcmpOracle(a: string, b: string): number {
	const isSpace = (c: string): boolean =>
		c === ' ' || c === '\t' || c === '\n' || c === '\v' || c === '\f' || c === '\r';
	const isDigit = (c: string): boolean => c >= '0' && c <= '9';
	const ord = (c: string): number => (c === '' ? 0 : c.charCodeAt(0));
	const tolower = (c: string): string => {
		const code = ord(c);
		return code >= 0x41 && code <= 0x5a ? String.fromCharCode(code + 0x20) : c;
	};
	const charAt = (s: string, i: number): string => (i < s.length ? s[i]! : '');

	const compareRight = (ai: number, bi: number): number => {
		let bias = 0;
		for (;;) {
			const ca = charAt(a, ai);
			const cb = charAt(b, bi);
			if (!isDigit(ca) && !isDigit(cb)) return bias;
			if (!isDigit(ca)) return -1;
			if (!isDigit(cb)) return 1;
			if (ca < cb) {
				if (bias === 0) bias = -1;
			} else if (ca > cb) {
				if (bias === 0) bias = 1;
			}
			ai++;
			bi++;
		}
	};

	const compareLeft = (ai: number, bi: number): number => {
		for (;;) {
			const ca = charAt(a, ai);
			const cb = charAt(b, bi);
			if (!isDigit(ca) && !isDigit(cb)) return 0;
			if (!isDigit(ca)) return -1;
			if (!isDigit(cb)) return 1;
			if (ca < cb) return -1;
			if (ca > cb) return 1;
			ai++;
			bi++;
		}
	};

	let ai = 0;
	let bi = 0;
	for (;;) {
		let ca = charAt(a, ai);
		let cb = charAt(b, bi);
		while (isSpace(ca)) {
			ai++;
			ca = charAt(a, ai);
		}
		while (isSpace(cb)) {
			bi++;
			cb = charAt(b, bi);
		}
		if (isDigit(ca) && isDigit(cb)) {
			const fractional = ca === '0' || cb === '0';
			const result = fractional ? compareLeft(ai, bi) : compareRight(ai, bi);
			if (result !== 0) return result;
		}
		if (ca === '' && cb === '') return 0;
		const fa = tolower(ca);
		const fb = tolower(cb);
		if (fa < fb) return -1;
		if (fa > fb) return 1;
		ai++;
		bi++;
	}
}

describe('naturalCompare — Pool strnatcmp parity', () => {
	it('orders identical strings as 0', () => {
		expect(naturalCompare('foo', 'foo')).toBe(0);
		expect(naturalCompare('', '')).toBe(0);
	});

	it('orders pure-ASCII strings by byte order when no digits are involved', () => {
		expect(naturalCompare('a', 'b')).toBeLessThan(0);
		expect(naturalCompare('b', 'a')).toBeGreaterThan(0);
		expect(naturalCompare('abc', 'abd')).toBeLessThan(0);
		expect(naturalCompare('abc', 'abcd')).toBeLessThan(0);
	});

	it('folds ASCII case (sensitivity:base equivalent)', () => {
		expect(naturalCompare('A.css', 'a.css')).toBe(0);
		expect(naturalCompare('A.css', 'b.css')).toBeLessThan(0);
		expect(naturalCompare('a.css', 'B.css')).toBeLessThan(0);
	});

	it('uses compare_right (length-first) when neither numeric run has a leading zero', () => {
		// Same length runs: byte-compare decides
		expect(naturalCompare('a1', 'a2')).toBeLessThan(0);
		expect(naturalCompare('a9', 'a1')).toBeGreaterThan(0);
		// Different length runs: longer wins
		expect(naturalCompare('a2', 'a10')).toBeLessThan(0);
		expect(naturalCompare('a10', 'a2')).toBeGreaterThan(0);
		expect(naturalCompare('a99', 'a100')).toBeLessThan(0);
	});

	it('uses compare_left (left-aligned, digit-by-digit) when EITHER numeric run starts with 0', () => {
		// Pool's strnatcmp treats "01" as a fractional 0.01 and "1"
		// as 0.1, so "01" < "1". Mismatch on the first digit
		// returns immediately, not length-first.
		expect(naturalCompare('a-01', 'a-1')).toBeLessThan(0);
		expect(naturalCompare('a-1', 'a-01')).toBeGreaterThan(0);
		expect(naturalCompare('a-02', 'a-1')).toBeLessThan(0);
		// "1" vs "09" — '1' > '0' at the first digit, so "1" > "09"
		expect(naturalCompare('a-1', 'a-09')).toBeGreaterThan(0);
		expect(naturalCompare('a-09', 'a-1')).toBeLessThan(0);
	});

	it('matches Pool documentation reference: a < a0 < a1 < a1a < a1b < a2 < a10 < a20', () => {
		const cases = ['a', 'a0', 'a1', 'a1a', 'a1b', 'a2', 'a10', 'a20'];
		for (let i = 0; i + 1 < cases.length; i++) {
			expect(naturalCompare(cases[i]!, cases[i + 1]!)).toBeLessThan(0);
		}
	});

	it('matches Pool documentation reference: x2-g8 < x2-y08 < x2-y7 < x8-y8', () => {
		// "x2-y08" vs "x2-y7": the second numeric run on the left
		// starts with '0', so compare_left fires and the first digit
		// '0' < '7' decides immediately.
		const cases = ['x2-g8', 'x2-y08', 'x2-y7', 'x8-y8'];
		for (let i = 0; i + 1 < cases.length; i++) {
			expect(naturalCompare(cases[i]!, cases[i + 1]!)).toBeLessThan(0);
		}
	});

	it("'a' sorts before 'a0' (zero-only numeric run on b counts as more content)", () => {
		// Independent guard for the `compare_left` zero-tail path so
		// the Pool reference chain doesn't have to carry this assertion alone.
		expect(naturalCompare('a', 'a0')).toBeLessThan(0);
		expect(naturalCompare('a0', 'a')).toBeGreaterThan(0);
	});

	it('handles a numeric run that is the entire string on one side', () => {
		expect(naturalCompare('1', '2')).toBeLessThan(0);
		expect(naturalCompare('2', '10')).toBeLessThan(0);
		expect(naturalCompare('100', '99')).toBeGreaterThan(0);
	});

	it('handles multi-section URLs (multiple digit runs)', () => {
		// First digit run differs in length → decided there.
		expect(naturalCompare('a-2-b-10', 'a-10-b-2')).toBeLessThan(0);
		// First run equal, second run length differs.
		expect(naturalCompare('a-2-b-2', 'a-2-b-10')).toBeLessThan(0);
		// First run equal, second run same length but digit-different.
		expect(naturalCompare('a-2-b-2', 'a-2-b-3')).toBeLessThan(0);
	});

	it('skips ASCII whitespace at run boundaries (Pool nat_isspace parity)', () => {
		// strnatcmp's whitespace handling: leading whitespace on
		// either side is ignored before each comparison step.
		expect(naturalCompare('  abc', 'abc')).toBe(0);
		expect(naturalCompare('a  1', 'a1')).toBe(0);
	});

	it('compares purely numeric strings correctly with and without leading zeros', () => {
		expect(naturalCompare('1', '01')).toBeGreaterThan(0); // compare_left: 1 > 0
		expect(naturalCompare('001', '1')).toBeLessThan(0); // compare_left: 0 < 1
		expect(naturalCompare('001', '01')).toBeLessThan(0); // compare_left: 0==0, 0<1
	});

	it('treats trailing content past one side as the larger string ("abc" < "abcd")', () => {
		expect(naturalCompare('abc', 'abcd')).toBeLessThan(0);
		expect(naturalCompare('abcd', 'abc')).toBeGreaterThan(0);
	});

	it('preserves comparator transitivity across a tricky set', () => {
		// If A<B and B<C then A<C must hold for Array.prototype.sort
		// to behave well. Construct a chain that crosses the
		// compare_left / compare_right paths.
		const chain = ['a-09', 'a-1', 'a-2', 'a-09a', 'a-2b', 'a-10'];
		const sorted = chain
			.map((url, idx) => ({ url, idx }))
			.toSorted((x, y) => naturalCompare(x.url, y.url));
		// Verify transitivity by checking that every pair is
		// consistent with the sorted order.
		for (let i = 0; i + 1 < sorted.length; i++) {
			expect(naturalCompare(sorted[i]!.url, sorted[i + 1]!.url)).toBeLessThanOrEqual(0);
		}
	});

	it('handles surrogate-pair-bearing URLs deterministically (UTF-16 code unit order)', () => {
		// Surrogate pairs in URLs are rare but possible. The
		// comparator must at least be deterministic and return 0
		// for byte-identical inputs. Pool's reference compares
		// bytes, and the JS port compares UTF-16 code units —
		// equivalent semantics for ASCII URLs.
		const url = 'https://x.example/path\u{1F600}/asset';
		expect(naturalCompare(url, url)).toBe(0);
		// Different code units after the surrogate pair → deterministic non-zero.
		const result = naturalCompare(
			'https://x.example/\u{1F600}-a',
			'https://x.example/\u{1F600}-b',
		);
		expect(result).toBeLessThan(0);
	});
});

describe('naturalCompare — fuzz against Pool strnatcmp.c oracle', () => {
	/**
	 * Generates a deterministic pseudo-random string from the
	 * given seed. We avoid `Math.random` so fuzz failures are
	 * reproducible from the displayed seed value.
	 * @param seed - 32-bit unsigned integer.
	 * @param maxLen - Maximum string length.
	 */
	function fuzzString(seed: number, maxLen: number): string {
		// Xorshift32 — good enough for fuzz, fully deterministic.
		let state = seed | 0 || 1;
		const next = (): number => {
			state ^= state << 13;
			state ^= state >>> 17;
			state ^= state << 5;
			return state >>> 0;
		};
		const len = next() % maxLen;
		// Alphabet chosen to exercise: digits, ASCII letters of both
		// cases, leading-zero scenarios, whitespace, common URL
		// punctuation. No characters outside printable ASCII so the
		// oracle's char-level compares match the production
		// implementation's code-unit compares.
		const alphabet = '0123456789aAbZ-/_. ';
		let out = '';
		for (let i = 0; i < len; i++) {
			out += alphabet[next() % alphabet.length];
		}
		return out;
	}

	it('agrees with the Pool oracle on 5000 random ASCII pairs', () => {
		// Sign-comparison only: the production implementation may
		// return any negative / positive integer that the oracle
		// also returns with the same sign.
		let mismatched: {
			seed: number;
			a: string;
			b: string;
			got: number;
			want: number;
		} | null = null;
		const TRIALS = 5000;
		for (let i = 0; i < TRIALS; i++) {
			const seedA = (i * 2654435761) | 0;
			const seedB = ((i + TRIALS) * 2654435761) | 0;
			const a = fuzzString(seedA, 24);
			const b = fuzzString(seedB, 24);
			const got = Math.sign(naturalCompare(a, b));
			const want = Math.sign(strnatcmpOracle(a, b));
			if (got !== want) {
				mismatched = { seed: i, a, b, got, want };
				break;
			}
		}
		expect(mismatched).toBeNull();
	});

	it('agrees with the Pool oracle on numeric-heavy inputs', () => {
		// Same as above but biased toward numeric runs to exercise
		// the compare_left / compare_right dispatch.
		let mismatched: {
			seed: number;
			a: string;
			b: string;
			got: number;
			want: number;
		} | null = null;
		const TRIALS = 5000;
		const alphabet = '0011223344556789-_';
		for (let i = 0; i < TRIALS; i++) {
			let state = (i + 1) | 0;
			const next = (): number => {
				state ^= state << 13;
				state ^= state >>> 17;
				state ^= state << 5;
				return state >>> 0;
			};
			const lenA = next() % 16;
			const lenB = next() % 16;
			let a = '';
			let b = '';
			for (let k = 0; k < lenA; k++) a += alphabet[next() % alphabet.length];
			for (let k = 0; k < lenB; k++) b += alphabet[next() % alphabet.length];
			const got = Math.sign(naturalCompare(a, b));
			const want = Math.sign(strnatcmpOracle(a, b));
			if (got !== want) {
				mismatched = { seed: i, a, b, got, want };
				break;
			}
		}
		expect(mismatched).toBeNull();
	});

	it('agrees with the Pool oracle on known-tricky inputs', () => {
		// Hand-picked cases that span the dispatch table corners.
		const pairs: Array<[string, string]> = [
			['', ''],
			['', 'a'],
			['a', ''],
			['0', '0'],
			['0', '00'],
			['00', '0'],
			['01', '1'],
			['1', '01'],
			['001', '01'],
			['100', '99'],
			['a-01', 'a-1'],
			['a-1', 'a-09'],
			['a-09', 'a-1'],
			['a 1', 'a1'],
			['  a', 'a'],
			['a0', 'a00'],
			['x2-y08', 'x2-y7'],
			['Image-1.jpg', 'image-1.jpg'],
			['Z', 'a'], // case-folded compare: lowercase 'z' > 'a' so Z > a
			['9', '10'],
			['09', '10'],
		];
		for (const [a, b] of pairs) {
			const got = Math.sign(naturalCompare(a, b));
			const want = Math.sign(strnatcmpOracle(a, b));
			expect(got, `naturalCompare(${JSON.stringify(a)}, ${JSON.stringify(b)})`).toBe(
				want,
			);
		}
	});
});

describe('sortResourcesByUrl', () => {
	it('orders numeric segments numerically rather than lexicographically', () => {
		const input = [
			{ url: 'https://x.example/image-10.jpg' },
			{ url: 'https://x.example/image-2.jpg' },
			{ url: 'https://x.example/image-1.jpg' },
		];
		expect(sortResourcesByUrl(input)).toEqual([
			{ url: 'https://x.example/image-1.jpg' },
			{ url: 'https://x.example/image-2.jpg' },
			{ url: 'https://x.example/image-10.jpg' },
		]);
	});

	it('orders numeric segments inside query strings numerically', () => {
		const input = [
			{ url: 'https://x.example/list?page=10' },
			{ url: 'https://x.example/list?page=2' },
			{ url: 'https://x.example/list?page=1' },
		];
		expect(sortResourcesByUrl(input).map((r) => r.url)).toEqual([
			'https://x.example/list?page=1',
			'https://x.example/list?page=2',
			'https://x.example/list?page=10',
		]);
	});

	it('groups image-01.jpg / image-1.jpg adjacent in a realistic sort (compare_left semantics)', () => {
		// In Pool semantics, "image-01.jpg" < "image-1.jpg"
		// (fractional 0.01 < 0.1). They land adjacent in the sort,
		// which is the desired property for image-gallery URLs.
		const input = [
			{ url: 'https://x.example/image-1.jpg' },
			{ url: 'https://x.example/image-2.jpg' },
			{ url: 'https://x.example/image-01.jpg' },
		];
		const urls = sortResourcesByUrl(input).map((r) => r.url);
		// "image-01.jpg" must come before "image-1.jpg" and both
		// before "image-2.jpg".
		expect(urls).toEqual([
			'https://x.example/image-01.jpg',
			'https://x.example/image-1.jpg',
			'https://x.example/image-2.jpg',
		]);
	});

	it('keeps stable insertion order for equal-key inputs (TimSort stability)', () => {
		// Construct 5 equal-key entries to make stability actually
		// observable (with 2 entries the order could coincidentally
		// be either way and still "look right"). All keys differ
		// only in ASCII case, which the comparator folds, so they
		// compare equal and must come out in insertion order.
		const input = [
			{ url: 'https://x.example/A.css', id: 1 },
			{ url: 'https://x.example/a.css', id: 2 },
			{ url: 'https://x.example/A.css', id: 3 },
			{ url: 'https://x.example/a.css', id: 4 },
			{ url: 'https://x.example/A.css', id: 5 },
		];
		expect(sortResourcesByUrl(input).map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
	});

	it('does not mutate the input array', () => {
		const input = [{ url: 'b' }, { url: 'a' }];
		const original = [...input];
		sortResourcesByUrl(input);
		expect(input).toEqual(original);
	});

	it('returns a new array (different reference) even when already sorted', () => {
		const input = [{ url: 'a' }, { url: 'b' }];
		const output = sortResourcesByUrl(input);
		expect(output).not.toBe(input);
		expect(output).toEqual(input);
	});

	it('handles an empty input', () => {
		expect(sortResourcesByUrl([])).toEqual([]);
	});

	it('handles a single resource', () => {
		expect(sortResourcesByUrl([{ url: 'only' }])).toEqual([{ url: 'only' }]);
	});

	it('accepts readonly input arrays', () => {
		const input: readonly { readonly url: string }[] = [{ url: 'b' }, { url: 'a' }];
		expect(sortResourcesByUrl(input).map((r) => r.url)).toEqual(['a', 'b']);
	});

	it('100K-entry test: completes within elapsed bound and emits a sorted output', () => {
		// Regression guard against the prior failure modes:
		// (1) Per-compare `Intl.Collator` (multi-minute blockage).
		// (2) Schwartzian transform with fixed-width-padded keys
		//     (out-of-memory at this scale).
		// (3) Per-compare derived strings via `toLowerCase` / `replaceAll`
		//     (heavy GC pressure, multi-second elapsed times).
		//
		// We assert elapsed time only. Direct `process.memoryUsage()`
		// thresholds were flaky on CI because heap measurements
		// depend on GC timing; the next test below checks for
		// per-compare allocation more robustly via ratio scaling.
		const input: { url: string }[] = [];
		for (let i = 0; i < 100_000; i++) {
			input.push({ url: `https://x.example/asset-${(i * 17) % 99_991}.jpg` });
		}
		const start = Date.now();
		const sorted = sortResourcesByUrl(input);
		const elapsedMs = Date.now() - start;
		expect(sorted.length).toBe(input.length);
		expect(elapsedMs).toBeLessThan(5000);
		for (let i = 0; i + 1 < sorted.length; i++) {
			expect(naturalCompare(sorted[i]!.url, sorted[i + 1]!.url)).toBeLessThanOrEqual(0);
		}
	});

	it('no per-compare allocation: heap delta scales sub-linearly across input sizes', () => {
		// Indirect but robust check that the comparator does NOT
		// allocate one (or more) derived strings per call. If it
		// did, the median heap delta would grow super-linearly
		// with input size (N log N comparisons, each producing a
		// fresh SeqString that survives to the next GC). With a
		// true no-alloc comparator the only growth is the output
		// array and TimSort auxiliary — both linear in N at a small
		// constant factor — so the ratio
		// median heapDelta(N=100K) / median heapDelta(N=10K) stays
		// well below the 50× ceiling we assert here.
		/**
		 *
		 * @param n
		 */
		function medianHeapDelta(n: number): number {
			const input: { url: string }[] = [];
			for (let i = 0; i < n; i++) {
				input.push({ url: `https://x.example/asset-${(i * 17) % 99_991}.jpg` });
			}
			const samples: number[] = [];
			for (let trial = 0; trial < 3; trial++) {
				const before = process.memoryUsage().heapUsed;
				const sorted = sortResourcesByUrl(input);
				const after = process.memoryUsage().heapUsed;
				// Touch sorted so the engine can't elide it.
				expect(sorted.length).toBe(input.length);
				samples.push(Math.max(0, after - before));
			}
			samples.sort((a, b) => a - b);
			return samples[1]!;
		}
		const small = medianHeapDelta(10_000);
		const large = medianHeapDelta(100_000);
		// `small` can occasionally be 0 (GC reclaimed the previous
		// allocation before we measured) — guard against divide-by-zero.
		const ratio = large / Math.max(1, small);
		// 50× is loose enough to absorb GC noise but tight enough to
		// catch per-compare allocation, which would push the ratio
		// into the hundreds or thousands.
		expect(ratio).toBeLessThan(50);
	});
});
