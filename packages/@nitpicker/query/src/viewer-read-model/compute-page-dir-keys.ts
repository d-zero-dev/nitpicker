import type { PageDirKeys } from './types.js';

import { tryParseUrl } from '@d-zero/shared/parse-url';

import { originDirnameKey } from './origin-dirname-key.js';

/** Marks a row whose URL did not parse, in the key-index arrays. */
const NONE = -1;

/**
 * Parses every row's URL once and keeps only what the page-list lookups need
 * from it — the row's directory key, its parent directory key and whether it
 * is a directory index — so `computeDisplayTitleByPageId` and
 * `computeDirIndexInboundLinkCountByPageId` do not parse each URL again
 * themselves.
 *
 * Why not keep the parsed URL objects: a parsed URL carries about twenty
 * fields (including the full href and its parts), and holding one per page for
 * the rest of the build would cost more than the second parse it saves. The
 * result is two `Int32Array`s of indices into a table of interned key strings
 * (a directory's key string exists once however many pages are in it) and one
 * byte per row for the index flag.
 *
 * The parent key is `originDirnameKey` of the same URL with its `dirname`
 * replaced by the path two segments up (`paths.slice(0, -2)`): `paths` of a
 * `/dir/` index ends with an empty segment, so for both an index page and the
 * pages beside it this lands on the directory above the page's own directory.
 * @param rows - The page rows, in the order the accessors will index them.
 * @returns Accessors by row index.
 * @example
 * const dirKeys = computePageDirKeys(sourceRows);
 * dirKeys.dirKeyAt(0); // 'example.com:/blog' for https://example.com/blog/post
 * dirKeys.parentDirKeyAt(0); // 'example.com:/'
 */
export function computePageDirKeys(
	rows: readonly { readonly url: string }[],
): PageDirKeys {
	const keys: string[] = [];
	const indexByKey = new Map<string, number>();
	const dirKeyIndex = new Int32Array(rows.length).fill(NONE);
	const parentDirKeyIndex = new Int32Array(rows.length).fill(NONE);
	const isIndex = new Uint8Array(rows.length);

	const intern = (key: string): number => {
		let index = indexByKey.get(key);
		if (index === undefined) {
			index = keys.length;
			keys.push(key);
			indexByKey.set(key, index);
		}
		return index;
	};

	for (const [i, row] of rows.entries()) {
		const parsed = tryParseUrl(row.url);
		if (!parsed) {
			continue;
		}
		dirKeyIndex[i] = intern(originDirnameKey(parsed));
		const parentDir = `/${parsed.paths.slice(0, -2).join('/')}`;
		parentDirKeyIndex[i] = intern(originDirnameKey({ ...parsed, dirname: parentDir }));
		isIndex[i] = parsed.isIndex ? 1 : 0;
	}

	return {
		keyCount: keys.length,
		isParsedAt: (index) => dirKeyIndex[index] !== NONE,
		dirKeyAt: (index) => {
			const keyIndex = dirKeyIndex[index];
			return keyIndex === undefined || keyIndex === NONE ? undefined : keys[keyIndex];
		},
		parentDirKeyAt: (index) => {
			const keyIndex = parentDirKeyIndex[index];
			return keyIndex === undefined || keyIndex === NONE ? undefined : keys[keyIndex];
		},
		isIndexAt: (index) => isIndex[index] === 1,
	};
}
