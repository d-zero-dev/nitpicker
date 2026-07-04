import type { UrlSortKey } from './types.js';

import { createReadStream } from 'node:fs';
import readline from 'node:readline';

import { compareUrlSortKeys } from './compare-url-sort-keys.js';

/**
 * A chunk file's read position — the next unread line's parsed key, or
 * `null` once the file is exhausted.
 */
interface ChunkCursor {
	/** The chunk file's line iterator. */
	lines: AsyncIterator<string>;
	/** The next unread key, or `null` when the file has no more lines. */
	next: UrlSortKey | null;
}

/**
 * Advances one cursor to its next line.
 * @param cursor - The cursor to advance.
 */
async function advance(cursor: ChunkCursor): Promise<void> {
	const { value, done } = await cursor.lines.next();
	cursor.next = done ? null : (JSON.parse(value) as UrlSortKey);
}

/**
 * K-way merges the sorted chunk files produced by
 * {@link import('./write-sorted-url-chunk.js').writeSortedUrlChunk} into a
 * single ascending stream, without loading more than one line per chunk into
 * memory at a time.
 *
 * Duplicate `original` URL strings (the same URL present in both `pages` and
 * `resources`) are collapsed to one entry — mirroring the `Set`-based dedup
 * the previous whole-archive-in-memory implementation did. Every cursor
 * whose head has the same `original` string as the round's winner is
 * drained together, not just the winner's own cursor — the same URL is
 * often the current head of more than one chunk file at once (e.g. once
 * from a `pages` chunk, once from a `resources` chunk), and advancing only
 * one of them would leave the other sitting unconsumed as a false "still
 * pending" duplicate. Dedup is intentionally keyed on `original` string
 * equality rather than `compareUrlSortKeys(...) === 0`: the comparator can
 * legitimately return `0` for two *different* URLs (e.g. basenames `"007"`
 * and `"7"` both parse to the numeral `7` under `numericalComparator`'s
 * natural-sort rules), and collapsing those would silently drop a distinct
 * URL instead of only deduplicating true repeats.
 *
 * This is necessary but not sufficient for a hard duplicate-free guarantee:
 * `compareUrlSortKeys` inherits `@d-zero/shared`'s `numericalComparator`,
 * a common-prefix-strip natural-sort comparator that is not guaranteed
 * transitive. A non-transitive comparator can make `Array.prototype.sort`
 * (used per-chunk in {@link
 * import('./write-sorted-url-chunk.js').writeSortedUrlChunk}) produce a
 * chunk file that is not globally consistent with another chunk's ordering,
 * which on rare, large real-world archives can still surface the same URL
 * at non-adjacent positions across chunks. That residual risk is the reason
 * {@link import('./url-sort-temp-table.js').prepareUrlSortTempTable} inserts
 * with `onConflict('url').ignore()` rather than a plain `insert` — this
 * function reduces how often a duplicate reaches that fail-safe, it doesn't
 * replace it.
 * @param chunkFilePaths - Paths to the sorted chunk files, in any order.
 * @param onLineConsumed - Called once per raw line read from any chunk file
 *   (before dedup), so callers can report merge progress as a percentage of
 *   the total rows written across every chunk — the yielded count alone
 *   undercounts whenever duplicates are collapsed.
 * @yields {UrlSortKey} Each distinct URL's sort key, in ascending `compareUrlSortKeys` order.
 * @example
 * for await (const key of mergeSortedUrlChunks(chunkFiles)) {
 *   console.log(key.original);
 * }
 */
export async function* mergeSortedUrlChunks(
	chunkFilePaths: readonly string[],
	onLineConsumed?: () => void,
): AsyncGenerator<UrlSortKey> {
	const cursors: ChunkCursor[] = chunkFilePaths.map((filePath) => {
		const lines = readline.createInterface({
			input: createReadStream(filePath, 'utf8'),
			crlfDelay: Infinity,
		});
		return { lines: lines[Symbol.asyncIterator](), next: null };
	});
	const advanceAndReport = async (cursor: ChunkCursor): Promise<void> => {
		await advance(cursor);
		if (cursor.next !== null) {
			onLineConsumed?.();
		}
	};
	await Promise.all(cursors.map((cursor) => advanceAndReport(cursor)));

	for (;;) {
		let minIndex = -1;
		for (const [index, cursor] of cursors.entries()) {
			if (cursor.next === null) {
				continue;
			}
			if (
				minIndex === -1 ||
				compareUrlSortKeys(cursor.next, cursors[minIndex]!.next!) < 0
			) {
				minIndex = index;
			}
		}
		if (minIndex === -1) {
			return;
		}

		const winner = cursors[minIndex]!.next!;
		for (const cursor of cursors) {
			if (cursor.next !== null && cursor.next.original === winner.original) {
				await advanceAndReport(cursor);
			}
		}
		yield winner;
	}
}
