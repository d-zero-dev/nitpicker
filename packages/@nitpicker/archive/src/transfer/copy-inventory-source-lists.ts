import type Archive from '../archive.js';

import fs from 'node:fs/promises';
import path from 'node:path';

/** Matches `Archive.saveInventorySourceList`'s own naming contract: `<sha256 hex>.txt`. */
const INVENTORY_FILE_NAME_PATTERN = /^[0-9a-f]{64}\.txt$/;

/**
 * Copies every `inventory/<sha256>.txt` source list from each source's
 * extracted tmpDir into the destination archive, via
 * `Archive#saveInventorySourceList` (the same write path `--inventory`/
 * `--recrawl` themselves use) — a plain filesystem operation, not SQL, so
 * this takes tmpDir paths and the destination `Archive`, not a `Knex`
 * transaction.
 *
 * Filenames are content-addressed (the sha256 of the list's own bytes),
 * so the same list appearing in two sources (an operator re-running
 * `--inventory` with the same file against both, say) copies once — `seen`
 * dedupes across sources, and `saveInventorySourceList` itself is a
 * same-name overwrite (idempotent) even without that guard. Anything not
 * matching {@link INVENTORY_FILE_NAME_PATTERN} — including a source whose
 * `inventory/` directory does not exist at all, the common case — is
 * skipped rather than copied verbatim, so an unrelated stray file
 * (there should never be one, but this function does not trust that)
 * cannot be smuggled into the output archive.
 * @param destination - The (writer) destination archive, opened with
 *   `openPluginData: true` so `write()` will re-tar this directory.
 * @param sourceTmpDirs - Each source's extracted tmpDir
 *   (`accessor.tmpDir`), in argument order.
 * @returns The number of distinct source lists copied.
 * @example
 * ```ts
 * const copied = await copyInventorySourceLists(destination, sources.map((s) => s.tmpDir));
 * ```
 */
export async function copyInventorySourceLists(
	destination: Archive,
	sourceTmpDirs: readonly string[],
): Promise<number> {
	const seen = new Set<string>();
	for (const sourceTmpDir of sourceTmpDirs) {
		const inventoryDir = path.join(sourceTmpDir, 'inventory');
		let entries: string[];
		try {
			entries = await fs.readdir(inventoryDir);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				continue;
			}
			throw error;
		}
		for (const entry of entries) {
			if (!INVENTORY_FILE_NAME_PATTERN.test(entry)) {
				continue;
			}
			const sha256 = entry.slice(0, -'.txt'.length);
			if (seen.has(sha256)) {
				continue;
			}
			seen.add(sha256);
			const bytes = await fs.readFile(path.join(inventoryDir, entry));
			await destination.saveInventorySourceList(sha256, bytes);
		}
	}
	return seen.size;
}
