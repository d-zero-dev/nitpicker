import { decomposeUrl } from '../decompose-url.js';

const DIGIT_CONTAINING_SEGMENT_PATTERN = /\d/;
const SEGMENT_PLACEHOLDER = '{n}';
const VALUE_PLACEHOLDER = '{v}';

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
		const pairs = queryKeys.map((k) => `${k}=${VALUE_PLACEHOLDER}`);
		key += `?${pairs.join('&')}`;
	}
	return key;
}
