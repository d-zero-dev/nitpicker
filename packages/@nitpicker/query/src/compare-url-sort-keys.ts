import type { UrlSortKey } from './types.js';

import { alphabeticalComparator } from '@d-zero/shared/sort/alphabetical';
import { dirComparator } from '@d-zero/shared/sort/dir';
import { numericalComparator } from '@d-zero/shared/sort/numerical';

/**
 * Compares two {@link UrlSortKey} values in the same order as
 * `@d-zero/shared/sort/path`'s `pathComparator`.
 *
 * The branch structure mirrors `pathComparator` exactly (host → path
 * hierarchy → basename, with `index` sorted first → extension → query →
 * hash → protocol → href) so that sorting `UrlSortKey`s never disagrees with
 * sorting the `ExURL`s they were extracted from. Only the comparison
 * primitives (`alphabeticalComparator` / `dirComparator` /
 * `numericalComparator`) are reused directly from `@d-zero/shared` — nothing
 * about how URLs compare is reimplemented here, only the field lookups
 * change from `ExURL` properties to `UrlSortKey` properties.
 * @param a - The first key to compare.
 * @param b - The second key to compare.
 * @returns A negative number if `a` sorts before `b`, positive if after, `0` if equal.
 * @example
 * const sorted = keys.toSorted(compareUrlSortKeys);
 */
export function compareUrlSortKeys(a: UrlSortKey, b: UrlSortKey): number {
	if (a.href === b.href) {
		return alphabeticalComparator(a.original, b.original);
	}
	const rHost = alphabeticalComparator(a.hostname, b.hostname);
	if (rHost) {
		return rHost;
	}
	const rPaths = dirComparator(a.paths, b.paths);
	if (rPaths) {
		return rPaths;
	}
	if (a.basename !== b.basename) {
		if (a.isIndex) return -1;
		if (b.isIndex) return 1;
		const rBasename = numericalComparator(a.basename, b.basename);
		if (rBasename) {
			return rBasename;
		}
	}
	const rExt = numericalComparator(a.extname, b.extname);
	if (rExt) {
		return rExt;
	}
	const rSearch = numericalComparator(a.search, b.search);
	if (rSearch) {
		return rSearch;
	}
	const rHash = numericalComparator(a.hash, b.hash);
	if (rHash) {
		return rHash;
	}
	const rProtocol = alphabeticalComparator(a.protocol, b.protocol);
	if (rProtocol) {
		return rProtocol;
	}
	return numericalComparator(a.href, b.href);
}
