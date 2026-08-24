/**
 * Effective cell budget for one spreadsheet, kept below Google Sheets'
 * documented 10,000,000-cell-per-spreadsheet limit. The margin absorbs
 * header rows, formatting metadata, and any rounding in row-count
 * estimates, so a report that lands close to the true limit still leaves
 * headroom rather than failing the final API call.
 */
export const CELL_BUDGET_LIMIT = 9_800_000;

/** One sheet's estimated size, before budget allocation. */
export interface SheetCellEstimate {
	/** Sheet display name (matches `CreateSheetSetting.name`). */
	readonly name: string;
	/** Column count (header row length). */
	readonly columns: number;
	/** Estimated data row count, from `CreateSheetSetting.estimateRowCount()`. */
	readonly estimatedRows: number;
}

/** One sheet's estimated size plus its budget allocation. */
export interface SheetCellAllocation extends SheetCellEstimate {
	/** Estimated maximum data rows this sheet can send within the shared budget. */
	readonly maxRows: number;
	/** `true` iff `estimatedRows` exceeds `maxRows` — this sheet is expected to be truncated. */
	readonly truncated: boolean;
}

/**
 * Computes an advisory cell-budget allocation across every selected sheet,
 * in priority order, for the pre-generation warning shown to the user.
 *
 * This is an *estimate* for display purposes only — the actual budget
 * enforcement during generation (`create-sheets.ts`'s Phase 2) decrements a
 * live remaining-cell counter by each sheet's real sent-row count as it
 * completes, not by this function's estimates. The two can disagree (a
 * sheet's `estimateRowCount()` is a `COUNT(*)`-style approximation, not a
 * guarantee), but that is fine: this function exists only to tell the user
 * up front which sheets are *likely* to be truncated and roughly by how
 * much, before any API calls are made.
 *
 * Every sheet's header row is assumed to be created unconditionally
 * (Phase 1 creates every selected sheet and sets its header before any
 * truncation decision is made), so the header cost for every sheet is
 * subtracted from the budget up front, before allocating the remainder to
 * data rows in priority order.
 * @param estimates - Per-sheet estimates, already ordered by priority
 *   (`Page List` first, etc. — see `report.ts`'s `SHEET_PRIORITY_ORDER`).
 * @param budget - Total usable cells across the spreadsheet. Defaults to
 *   {@link CELL_BUDGET_LIMIT}; overridable for tests.
 * @returns One allocation per input estimate, in the same order.
 * @example
 * const allocations = estimateCellBudget([
 *   { name: 'Page List', columns: 65, estimatedRows: 200_000 },
 *   { name: 'Links', columns: 9, estimatedRows: 200_000 },
 * ]);
 * const truncatedNames = allocations.filter((a) => a.truncated).map((a) => a.name);
 */
export function estimateCellBudget(
	estimates: readonly SheetCellEstimate[],
	budget: number = CELL_BUDGET_LIMIT,
): SheetCellAllocation[] {
	const headerCost = estimates.reduce((sum, estimate) => sum + estimate.columns, 0);
	let remaining = Math.max(0, budget - headerCost);
	const allocations: SheetCellAllocation[] = [];
	for (const estimate of estimates) {
		const maxRowsForBudget =
			estimate.columns > 0
				? Math.floor(remaining / estimate.columns)
				: estimate.estimatedRows;
		const maxRows = Math.min(maxRowsForBudget, estimate.estimatedRows);
		allocations.push({
			...estimate,
			maxRows,
			truncated: estimate.estimatedRows > maxRows,
		});
		remaining = Math.max(0, remaining - maxRows * estimate.columns);
	}
	return allocations;
}
