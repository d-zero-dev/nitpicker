/**
 * Formats the warning shown when an existing archive was crawled with request
 * headers that this run did not supply again.
 *
 * Header values are never stored in the archive, so the crawl would silently
 * continue without them and the protected pages would come back 401/403.
 * Only the header names are printed — never a value.
 * @param missingNames - Header names recorded in the archive and absent from this run.
 * @returns The warning line.
 * @example
 * formatMissingRequestHeaderWarning(['Authorization']);
 * // => 'Warning: this archive was crawled with request header(s) Authorization, but ...'
 */
export function formatMissingRequestHeaderWarning(
	missingNames: readonly string[],
): string {
	return `Warning: this archive was crawled with request header(s) ${missingNames.join(', ')}, but they were not supplied for this run. Header values are never stored in the archive; pass --header / --authorization / --header-file again, or protected pages will be requested without them.`;
}
