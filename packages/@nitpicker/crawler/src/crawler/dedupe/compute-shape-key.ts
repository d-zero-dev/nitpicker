import { decodeURIComponentSafely } from '@d-zero/shared/decode-uri-safely';

import { decomposeUrl } from '../decompose-url.js';

const DIGIT_CONTAINING_SEGMENT_PATTERN = /\d/;
const SEGMENT_PLACEHOLDER = '{n}';
const VALUE_PLACEHOLDER = '{v}';

/**
 * Recursively decodes and re-splits a single query key that may itself be a
 * percent-encoded `key=value&key=value...` blob (see the "query trap" case
 * in `computeShapeKey`'s doc comment), peeling one layer of encoding at a
 * time so a multiply-encoded blob (`%2526` → `%26` → `&`) still converges.
 *
 * Each call first decodes via `decodeURIComponentSafely` (falls back to the
 * input unchanged on malformed `%` sequences). If decoding changed
 * anything, there may be another layer underneath, so it recurses on the
 * decoded string to peel further. Once decoding is a no-op (fully decoded,
 * or undecodable), the value is at a fixed point: split on `&`/`=` if
 * either is now present and recurse on the pieces (each piece may need its
 * own decode chain); otherwise it's a leaf.
 *
 * Every recursive call operates on a string strictly shorter than its
 * input — a successful decode always shrinks length (a `%XX` triplet never
 * expands to more than 1 output character), and splitting on a delimiter
 * that is present at a fixed point always yields a strictly shorter piece
 * — so this terminates for any finite input without needing an explicit
 * depth limit.
 * @param key - A single raw query key, as returned by `decomposeUrl`.
 * @returns The one or more sub-key names this key flattens to.
 */
function flattenQueryKey(key: string): string[] {
	const decoded = decodeURIComponentSafely(key);
	if (decoded !== key) return flattenQueryKey(decoded);
	if (!decoded.includes('=') && !decoded.includes('&')) return [decoded];
	return decoded.split('&').flatMap((pair) => flattenQueryKey(pair.split('=')[0] ?? ''));
}

/**
 * Flattens and normalizes a list of query keys so that keys whose variable
 * content leaked into the key name itself (via nested percent-encoding)
 * still converge to the same set of sub-key names regardless of the
 * variable values or the sub-pairs' original order.
 *
 * Deliberately does NOT deduplicate the flattened keys: a legitimate
 * multi-value query (`?tag=a&tag=b`) must stay distinguishable from a
 * single-value one (`?tag=a`) — collapsing repeated key names would fold
 * pages with a different facet count into the same shape, which is a
 * correctness regression unrelated to the encoding bug this function fixes.
 * @param keys - Raw query keys, as returned by `decomposeUrl`.
 * @returns The flattened, sorted key names.
 */
function flattenQueryKeys(keys: string[]): string[] {
	return keys
		.flatMap((key) => flattenQueryKey(key))
		.toSorted((a, b) => a.localeCompare(b));
}

/**
 * Computes a URL "shape" key: the host plus path/query with every path
 * segment that contains a digit collapsed to a fixed placeholder, and every
 * query value (regardless of content) collapsed to a fixed placeholder.
 *
 * This absorbs both the "numeric pager" trap shape (`/news/date/2024/` and
 * `/news/date/1.5e+32/` collapse to the same key) and the "query trap" shape
 * (`?page=1` / `?page=2` / `?session=ab12cd` all collapse to the same key),
 * without needing two separate `parentPath` definitions the way issue
 * #208's original proposal did.
 *
 * Uses `../decompose-url.ts` (the pagination-detection one) — NOT
 * `../../archive/populate-ref-tables/decompose-url.ts`, an unrelated same-named
 * module with a different `DecomposedUrl` shape used for ref-table population.
 *
 * The masking rule here is the deliberate inverse of
 * `../../archive/body-hash/mask-dynamic-ids.ts`: that module leaves
 * pure-digit tokens untouched (they are more likely stable content than a
 * dynamic id) and only masks mixed alphanumeric runs. A shape key needs the
 * opposite: ANY digit inside a path segment marks it as "probably a
 * pagination/date/id token", so the whole segment is collapsed. Do not share
 * masking logic between the two — they classify the same kind of text for
 * opposite purposes.
 *
 * Query keys are additionally run through `flattenQueryKeys` before being
 * folded into the key, because `ExURL`'s query normalization (`URLSearchParams`
 * decode-then-re-encode round trip in `@d-zero/shared/parse-url`) means a
 * site that double-encodes `&`/`=` inside a query value produces a URL whose
 * query string still arrives here percent-encoded — `decomposeUrl`'s literal
 * `&`/`=` split then sees ONE key that is itself a percent-encoded
 * `key=value&key=value...` blob, with any variable content buried inside
 * that key name rather than in a value. Without flattening, every such URL
 * gets a distinct key name and therefore a distinct shape key, which
 * silently defeats `--dedupe-cap` (issue #351) no matter the threshold.
 *
 * This changes the shape key computed for URLs that hit the flattening
 * path. `dedupe_cap_events.shape_key` (see `archive/create-adjunct-tables.ts`)
 * is an append-only value frozen at crawl time and never rewritten, so an
 * archive crawled before this fix that happened to already have a
 * `dedupe_cap_events` row for such a URL (rare, since the bug largely
 * prevented capping from firing on it in the first place) will not
 * re-match on the next `backfillDedupeCapEventId` recompute — the same
 * self-healing-backfill trade-off any shape-key algorithm change makes.
 * @param url - A URL string (protocol-agnostic `//host/...` or full
 *   `https://host/...`), typically `ExURL.withoutHashAndAuth`.
 * @returns The shape key, or `null` if `url` cannot be decomposed.
 * @example
 * ```ts
 * computeShapeKey('//example.com/news/date/2024/');
 * // => 'example.com/news/date/{n}/'
 * computeShapeKey('//example.com/news/date/1.5e+32/');
 * // => 'example.com/news/date/{n}/' — same shape
 * computeShapeKey('//example.com/list?page=1');
 * // => 'example.com/list?page={v}'
 * ```
 */
export function computeShapeKey(url: string): string | null {
	const decomposed = decomposeUrl(url);
	if (!decomposed) return null;

	const { host, pathSegments, queryKeys } = decomposed;

	const shapedSegments = pathSegments.map((segment) =>
		DIGIT_CONTAINING_SEGMENT_PATTERN.test(segment) ? SEGMENT_PLACEHOLDER : segment,
	);

	let key = host;
	if (shapedSegments.length > 0) {
		key += `/${shapedSegments.join('/')}`;
	}
	if (queryKeys.length > 0) {
		const flattenedKeys = flattenQueryKeys(queryKeys);
		const pairs = flattenedKeys.map((k) => `${k}=${VALUE_PLACEHOLDER}`);
		key += `?${pairs.join('&')}`;
	}
	return key;
}
