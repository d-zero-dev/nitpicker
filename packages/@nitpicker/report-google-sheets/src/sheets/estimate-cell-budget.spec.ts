import { describe, expect, it } from 'vitest';

import { estimateCellBudget } from './estimate-cell-budget.js';

describe('estimateCellBudget', () => {
	it('allocates every requested row when the total fits the budget', () => {
		const allocations = estimateCellBudget(
			[
				{ name: 'Page List', columns: 10, estimatedRows: 100 },
				{ name: 'Links', columns: 5, estimatedRows: 50 },
			],
			10_000,
		);
		expect(allocations[0]).toMatchObject({ maxRows: 100, truncated: false });
		expect(allocations[1]).toMatchObject({ maxRows: 50, truncated: false });
	});

	it('allocates by priority order, giving the first sheet everything it needs first', () => {
		const allocations = estimateCellBudget(
			[
				{ name: 'Page List', columns: 10, estimatedRows: 90 },
				{ name: 'Links', columns: 10, estimatedRows: 90 },
			],
			// Budget: 1000 total - header cost (10+10=20) = 980 remaining.
			// Page List takes 90*10=900, leaving 80 -> Links can only fit 8 rows.
			1000,
		);
		expect(allocations[0]).toMatchObject({ maxRows: 90, truncated: false });
		expect(allocations[1]).toMatchObject({ maxRows: 8, truncated: true });
	});

	it('lets an earlier sheet consuming less than its request roll the remainder to the next sheet', () => {
		const allocations = estimateCellBudget(
			[
				{ name: 'Violations', columns: 10, estimatedRows: 5 },
				{ name: 'Discrepancies', columns: 10, estimatedRows: 100 },
			],
			1000,
		);
		// header cost = 20, remaining = 980. Violations only needs 5*10=50,
		// leaving 930 for Discrepancies (needs 1000, fits within 930/10=93).
		expect(allocations[0]).toMatchObject({ maxRows: 5, truncated: false });
		expect(allocations[1]).toMatchObject({ maxRows: 93, truncated: true });
	});

	it('subtracts every sheet header cost up front, even for sheets later in priority order', () => {
		const allocations = estimateCellBudget(
			[
				{ name: 'A', columns: 100, estimatedRows: 0 },
				{ name: 'B', columns: 100, estimatedRows: 0 },
			],
			250,
		);
		// header cost = 200, remaining = 50 — but both sheets requested 0 rows,
		// so no data-row truncation occurs regardless.
		expect(allocations[0]).toMatchObject({ maxRows: 0, truncated: false });
		expect(allocations[1]).toMatchObject({ maxRows: 0, truncated: false });
	});

	it('never allocates a negative maxRows when the budget is already exhausted by earlier sheets', () => {
		const allocations = estimateCellBudget(
			[
				{ name: 'Page List', columns: 10, estimatedRows: 1000 },
				{ name: 'Links', columns: 10, estimatedRows: 100 },
			],
			120,
		);
		// header cost = 20, remaining = 100 -> Page List takes all 10 rows it can (100/10=10).
		expect(allocations[0]).toMatchObject({ maxRows: 10, truncated: true });
		expect(allocations[1]).toMatchObject({ maxRows: 0, truncated: true });
	});

	it('uses CELL_BUDGET_LIMIT as the default budget', () => {
		const allocations = estimateCellBudget([
			{ name: 'Page List', columns: 65, estimatedRows: 10 },
		]);
		expect(allocations[0]).toMatchObject({ maxRows: 10, truncated: false });
	});
});
