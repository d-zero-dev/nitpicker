import type { ParsedHeader, RequestHeaderFlags } from './types.js';

import { parseHeaderLine } from './parse-header-line.js';
import { readHeaderFile } from './read-header-file.js';

/**
 * Collapses `--header-file`, `--header` and `--authorization` into one
 * `Name → value` map for the crawler.
 *
 * Each header name may be given once across all three sources
 * (case-insensitive). Silently letting one source win would hide a
 * misconfiguration — especially for `Authorization`, where the wrong token
 * would fail with an opaque 401 — so a duplicate is an error that names the
 * two sources (never the values).
 * @param flags - The header-related CLI flags.
 * @returns The headers, or `undefined` when none were given.
 * @throws {Error} When a header is malformed or a name is given twice.
 * @example
 * await resolveRequestHeaders({ header: ['X-Api-Key: k'], authorization: 'Bearer t' });
 * // => { 'X-Api-Key': 'k', Authorization: 'Bearer t' }
 */
export async function resolveRequestHeaders(
	flags: RequestHeaderFlags,
): Promise<Record<string, string> | undefined> {
	const entries: { header: ParsedHeader; source: string }[] = [];

	if (flags.headerFile) {
		for (const header of await readHeaderFile(flags.headerFile)) {
			entries.push({ header, source: `--header-file ${flags.headerFile}` });
		}
	}
	for (const line of flags.header ?? []) {
		entries.push({ header: parseHeaderLine(line), source: '--header' });
	}
	if (flags.authorization !== undefined) {
		entries.push({
			header: parseHeaderLine(`Authorization: ${flags.authorization}`),
			source: '--authorization',
		});
	}

	if (entries.length === 0) {
		return undefined;
	}

	const seen = new Map<string, string>();
	const result: Record<string, string> = {};
	for (const { header, source } of entries) {
		const key = header.name.toLowerCase();
		const previous = seen.get(key);
		if (previous !== undefined) {
			throw new Error(
				`Header "${header.name}" is specified more than once (${previous} and ${source}).`,
			);
		}
		seen.set(key, source);
		result[header.name] = header.value;
	}
	return result;
}
