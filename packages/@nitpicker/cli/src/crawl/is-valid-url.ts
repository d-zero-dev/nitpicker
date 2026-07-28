/**
 * Checks whether a string is parseable by the `URL` constructor — the sole
 * validity contract every URL-list entry point in the `crawl` command
 * shares (positional args, `--list`, `--list-file`, `--inventory`), so a
 * future change to what counts as a valid URL only needs to happen here.
 * @param url - The candidate string to check.
 * @returns `true` if `new URL(url)` would not throw.
 * @example
 * ```ts
 * isValidUrl('https://example.com/'); // true
 * isValidUrl('not-a-url'); // false
 * ```
 */
export function isValidUrl(url: string): boolean {
	try {
		new URL(url);
		return true;
	} catch {
		return false;
	}
}
