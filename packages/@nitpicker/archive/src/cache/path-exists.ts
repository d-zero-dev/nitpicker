import fs from 'node:fs/promises';

/**
 * Async existence probe — avoids blocking the event loop on the common
 * "check before remove" path shared by
 * {@link import('./clear-archive-cache-root.js').clearArchiveCacheRoot} and
 * {@link import('./clear-archive-cache-entry.js').clearArchiveCacheEntry}.
 * @param targetPath - Absolute path to probe.
 * @returns `true` if the path is reachable via `fs.access`.
 */
export async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await fs.access(targetPath);
		return true;
	} catch {
		return false;
	}
}
