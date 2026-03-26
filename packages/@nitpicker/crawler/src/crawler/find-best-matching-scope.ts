import type { ExURL } from '@d-zero/shared/parse-url';

/**
 * Find the scope URL with the deepest matching path for a given URL.
 *
 * Among all scope URLs sharing the same hostname, returns the one whose
 * path segments are a prefix of the target URL's path segments and which
 * has the greatest depth. A root scope (paths: `['']`) matches all paths
 * under the same hostname. Returns `null` if no scope URL matches.
 * @param url - The parsed URL to match against scope URLs.
 * @param scopes - The list of scope URLs to search.
 * @returns The best-matching scope URL, or `null` if none match.
 */
export function findBestMatchingScope(
	url: ExURL,
	scopes: readonly ExURL[],
): ExURL | null {
	let bestMatch: ExURL | null = null;
	let maxDepth = -1;

	for (const scope of scopes) {
		if (url.hostname !== scope.hostname) {
			continue;
		}

		const isMatch = isPathMatch(url.paths, scope.paths);
		if (isMatch && scope.depth > maxDepth) {
			bestMatch = scope;
			maxDepth = scope.depth;
		}
	}

	return bestMatch;
}

/**
 * Check whether a target path is equal to or is a descendant of a base path.
 *
 * A root base path (`['']`) unconditionally matches any target path.
 * Otherwise, compares path segments element by element — the target path
 * matches if all segments of the base path appear in the same positions
 * at the beginning of the target path.
 * @param targetPaths - The path segments of the URL being checked.
 * @param basePaths - The path segments of the scope URL to match against.
 * @returns `true` if the target path starts with or equals the base path.
 */
function isPathMatch(targetPaths: string[], basePaths: string[]): boolean {
	// Root scope (paths: ['']) matches all paths under the same hostname
	if (basePaths.length === 1 && basePaths[0] === '') {
		return true;
	}

	if (targetPaths.length < basePaths.length) {
		return false;
	}

	for (const [i, basePath] of basePaths.entries()) {
		if (targetPaths[i] !== basePath) {
			return false;
		}
	}

	return true;
}
