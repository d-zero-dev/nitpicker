import type { ErrorRecord } from './types.js';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Parse `error.log` entries (`[pid(main)] <url> <message…>`) for archives that
 * predate the `crawl_errors` table. Only the first line of each entry is read —
 * the cause token lives there; stack-trace continuation lines are ignored.
 * @param tmpDir - The accessor's working directory holding `error.log`.
 * @returns Failure records, or empty when the log is missing.
 */
export async function readErrorLog(tmpDir: string): Promise<ErrorRecord[]> {
	let text: string;
	try {
		text = await readFile(path.join(tmpDir, 'error.log'), 'utf8');
	} catch {
		return [];
	}
	const records: ErrorRecord[] = [];
	// Match only the `[pid(main|sub)] ` header, then split the remainder by hand:
	// a single regex with two greedy trailing groups (`(\S+)\s*(.*)`) is flagged
	// for super-linear backtracking, and slicing is both linear and clearer.
	const header = /^\[\d+\((?:main|sub)\)\]\s+/;
	for (const line of text.split('\n')) {
		const match = header.exec(line);
		if (!match) {
			continue;
		}
		const rest = line.slice(match[0].length);
		const spaceIndex = rest.indexOf(' ');
		const rawUrl = spaceIndex === -1 ? rest : rest.slice(0, spaceIndex);
		records.push({
			url: rawUrl === 'null' || rawUrl === '' ? null : rawUrl,
			message: spaceIndex === -1 ? '' : rest.slice(spaceIndex + 1),
		});
	}
	return records;
}
