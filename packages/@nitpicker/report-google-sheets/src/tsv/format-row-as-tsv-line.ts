import type { Cell } from '@d-zero/google-sheets';

import { cellToPlainString } from './cell-to-plain-string.js';
import { escapeTsvField } from './escape-tsv-field.js';

/**
 * Formats one table row as a single TSV line (no trailing newline).
 * @param row - Cells in column order.
 * @returns Tab-separated, escaped line.
 */
export function formatRowAsTsvLine(row: readonly Cell[]): string {
	return row.map((cell) => escapeTsvField(cellToPlainString(cell))).join('\t');
}
