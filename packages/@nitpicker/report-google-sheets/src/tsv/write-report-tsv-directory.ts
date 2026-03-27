import type { Cell } from '@d-zero/google-sheets';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { escapeTsvField } from './escape-tsv-field.js';
import { formatRowAsTsvLine } from './format-row-as-tsv-line.js';

/**
 * Snapshot of one buffered tab (header row + data rows).
 */
interface ReportTsvTabSnapshot {
	/** Header labels (first row). */
	readonly headers: readonly string[];
	/** Data rows only (excludes the header row). */
	readonly rows: readonly (readonly Cell[])[];
}

/**
 * Turns a report tab title into a safe filename stem (no extension).
 * @param title - Sheet tab name (e.g. `"Page List"`).
 * @returns Filesystem-safe base name.
 */
function sanitizeReportTsvFileStem(title: string): string {
	return (
		title
			.replaceAll(/[/\\:*?"<>|]/g, '-')
			.replaceAll(/\s+/g, ' ')
			.trim() || 'sheet'
	);
}

/**
 * Writes every buffered tab as a UTF-8 `.tsv` file into the target directory.
 * @param outputDir - Target directory (created recursively).
 * @param tabs - Map of tab title → header row and data rows.
 */
export async function writeReportTsvDirectory(
	outputDir: string,
	tabs: ReadonlyMap<string, ReportTsvTabSnapshot>,
): Promise<void> {
	await mkdir(outputDir, { recursive: true });
	for (const [title, snapshot] of tabs) {
		const stem = sanitizeReportTsvFileStem(title);
		const filePath = path.join(outputDir, `${stem}.tsv`);
		const headerLine = snapshot.headers.map((h) => escapeTsvField(h ?? '')).join('\t');
		const body = snapshot.rows.map((row) => formatRowAsTsvLine(row)).join('\n');
		const content = body.length > 0 ? `${headerLine}\n${body}\n` : `${headerLine}\n`;
		await writeFile(filePath, content, 'utf8');
	}
}
