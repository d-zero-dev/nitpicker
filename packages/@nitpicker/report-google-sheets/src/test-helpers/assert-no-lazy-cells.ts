import type { Cell as CellType } from '@d-zero/google-sheets';

import { Cell } from '@d-zero/google-sheets';
import { expect } from 'vitest';

/**
 * Asserts that no cell in the given rows is a lazy (`createCellData(() => ...)`)
 * cell — i.e. every cell's `provide` is the base `Cell.prototype.provide`,
 * not an overridden `LazyCell.prototype.provide`.
 *
 * `@d-zero/google-sheets` detects a lazy cell via this exact identity check
 * (`containsLazyCell`) and, once one appears, disables `Sheet#appendRow`'s
 * automatic 2500-row flush for every subsequent row until an explicit
 * `flush()` — the mechanism that let the pre-rewrite Page List's
 * "Internal Referrers" thunk buffer an entire batch with no flush and OOM.
 * This assertion pins every rewritten sheet against reintroducing that
 * pattern.
 * @param rows - Rows to check, as produced by `CreateSheetSetting.run()`.
 */
export function assertNoLazyCells(rows: readonly CellType[][]): void {
	for (const row of rows) {
		for (const cell of row) {
			expect(cell.provide).toBe(Cell.prototype.provide);
		}
	}
}
