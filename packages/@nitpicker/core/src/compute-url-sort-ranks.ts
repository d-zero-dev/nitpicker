import { nativeBinding } from './native-binding.js';

/** The native call addresses the URL bytes with `u32` offsets. */
const MAX_URL_BYTES = 4_294_967_295;

/**
 * Ranks URLs in the natural order the viewer lists them in: numbers inside
 * a path compare by value (`page2` before `page10`), letter case and
 * percent-escapes do not split the order, a directory's own page comes
 * before its index pages and its children, and the host decides before the
 * path. The full definition is the `nitpicker_url_key` crate's docs.
 *
 * The order is a total order: the same URLs in any input order get the same
 * ranking, and identical URLs rank in input order. It is persisted (the
 * viewer read model stores each page's rank), so a change to it needs a read
 * model schema version bump.
 *
 * Parses each URL once, natively, and sorts on the native thread pool; only
 * two buffers cross the boundary however many URLs there are.
 * @param urls - The URLs to rank. Each must be a well-formed string (a lone
 *   surrogate is written as U+FFFD).
 * @returns For each input position, the rank (zero-based position in the
 *   sorted list) of that URL — a permutation of `0..urls.length`.
 * @example
 * ```ts
 * computeUrlSortRanks([
 * 	'https://example.com/page10',
 * 	'https://example.com/page2',
 * 	'https://example.com/',
 * ]); // Uint32Array [2, 1, 0]
 * ```
 */
export function computeUrlSortRanks(urls: readonly string[]): Uint32Array {
	// One encoding pass into a buffer sized for the worst case (3 UTF-8 bytes
	// per UTF-16 unit), rather than measuring every URL and encoding it again.
	let capacity = 0;
	for (const url of urls) {
		capacity += url.length * 3;
	}
	const bytes = Buffer.allocUnsafe(capacity);
	const offsets = new Uint32Array(urls.length + 1);
	let total = 0;
	for (const [index, url] of urls.entries()) {
		total += bytes.write(url, total, 'utf8');
		if (total > MAX_URL_BYTES) {
			throw new RangeError(
				`The URLs take more than ${MAX_URL_BYTES} bytes (4 GiB), which the native call cannot address.`,
			);
		}
		offsets[index + 1] = total;
	}
	return nativeBinding.computeUrlSortRanks(bytes.subarray(0, total), offsets);
}
