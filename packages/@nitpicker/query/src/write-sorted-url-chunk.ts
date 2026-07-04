import fs from 'node:fs/promises';
import path from 'node:path';

import { compareUrlSortKeys } from './compare-url-sort-keys.js';
import { toUrlSortKey } from './to-url-sort-key.js';

/**
 * Parses, sorts, and persists one chunk of URLs to a JSON-Lines temp file —
 * the "split" half of an external merge sort.
 *
 * Only this chunk's `UrlSortKey`s are held in memory at once; the caller is
 * expected to let `urls` and the return value's closure go out of scope
 * before reading the next chunk, so a multi-million-URL archive never has
 * more than one chunk's worth of parsed URLs live at the same time.
 * @param urls - The chunk's raw URL strings.
 * @param tmpDir - Directory to write the chunk file into (must already exist).
 * @param chunkIndex - Used to build a unique, order-independent filename.
 * @returns The path to the written chunk file.
 * @example
 * const file = await writeSortedUrlChunk(urls, tmpDir, 0);
 */
export async function writeSortedUrlChunk(
	urls: readonly string[],
	tmpDir: string,
	chunkIndex: number,
): Promise<string> {
	const keys = urls.map((url) => toUrlSortKey(url)).toSorted(compareUrlSortKeys);

	const filePath = path.join(tmpDir, `chunk-${chunkIndex}.jsonl`);
	const content = keys.map((key) => JSON.stringify(key)).join('\n');
	await fs.writeFile(filePath, content.length > 0 ? `${content}\n` : '', 'utf8');
	return filePath;
}
