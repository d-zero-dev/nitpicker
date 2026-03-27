/**
 * Escapes a single TSV field (RFC 4180-style quoting when needed).
 * @param raw - Unescaped cell text.
 * @returns Safe field for a tab-separated line.
 */
export function escapeTsvField(raw: string): string {
	if (/[\t\r\n"]/.test(raw)) {
		return `"${raw.replaceAll('"', '""')}"`;
	}
	return raw;
}
