import type { CreateSheet, CreateSheetSetting, RunSheetContext } from './types.js';
import type { MockSheet } from '../test-helpers/create-mock-sheet.js';

import { requireViewerReadModel } from '@nitpicker/query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMockSheet } from '../test-helpers/create-mock-sheet.js';

import { createSheets } from './create-sheets.js';

vi.mock('@nitpicker/query', () => ({
	requireViewerReadModel: vi.fn(),
}));

vi.mock('./estimate-cell-budget.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./estimate-cell-budget.js')>();
	// `estimateCellBudget`'s own `budget` parameter defaults to a
	// *module-local* reference to `CELL_BUDGET_LIMIT` inside the real
	// (unmocked) module, so simply overriding the exported constant here
	// wouldn't affect a call site that omits the second argument (as
	// `create-sheets.ts` does). Wrap it to force the mocked budget through
	// explicitly, keeping it consistent with the exported `CELL_BUDGET_LIMIT`
	// that `create-sheets.ts` reads directly for its own Phase 2 math.
	return {
		CELL_BUDGET_LIMIT: 8,
		estimateCellBudget: (estimates: Parameters<typeof actual.estimateCellBudget>[0]) =>
			actual.estimateCellBudget(estimates, 8),
	};
});

const NO_ACCESSOR = undefined as never;

/** A dummy 2-cell row; `createMockSheet` doesn't inspect row contents. */
const ROW = [{}, {}] as never;

/**
 * Builds a `CreateSheet` factory around a fixed settings object, for
 * orchestration-level tests that don't care about real headers/streaming.
 * @param setting - The setting `createSheets` should receive for this sheet.
 */
function makeCreateSheet(setting: CreateSheetSetting): CreateSheet {
	return () => Promise.resolve(setting);
}

/**
 * Builds a registry of fake `Sheets`/`Sheet` pairs keyed by name, mirroring
 * the real `Sheets.create(name)`'s per-name caching (repeated calls for the
 * same name return the same tab).
 */
function makeFakeSheets() {
	const registry = new Map<string, MockSheet>();
	return {
		sheets: {
			create: (name: string) => {
				let mock = registry.get(name);
				if (!mock) {
					mock = createMockSheet();
					registry.set(name, mock);
				}
				return Promise.resolve(mock.sheet);
			},
		} as never,
		getMock: (name: string) => registry.get(name),
	};
}

describe('createSheets', () => {
	beforeEach(() => {
		vi.mocked(requireViewerReadModel).mockReset();
		vi.mocked(requireViewerReadModel).mockResolvedValue();
	});

	it('does not require the viewer read model when no selected sheet needs it', async () => {
		const { sheets } = makeFakeSheets();
		await createSheets({
			sheets,
			accessor: NO_ACCESSOR,
			reports: [],
			createSheetList: [
				makeCreateSheet({
					name: 'Violations',
					createHeaders: () => ['A', 'B'],
					estimateRowCount: () => Promise.resolve(0),
					run: () => Promise.resolve(),
				}),
			],
			options: { silent: true },
		});
		expect(requireViewerReadModel).not.toHaveBeenCalled();
	});

	it('requires the viewer read model once when any selected sheet needs it', async () => {
		const { sheets } = makeFakeSheets();
		await createSheets({
			sheets,
			accessor: NO_ACCESSOR,
			reports: [],
			createSheetList: [
				makeCreateSheet({
					name: 'Page List',
					requiresReadModel: true,
					createHeaders: () => ['A', 'B'],
					estimateRowCount: () => Promise.resolve(0),
					run: () => Promise.resolve(),
				}),
				makeCreateSheet({
					name: 'Violations',
					createHeaders: () => ['A', 'B'],
					estimateRowCount: () => Promise.resolve(0),
					run: () => Promise.resolve(),
				}),
			],
			options: { silent: true },
		});
		expect(requireViewerReadModel).toHaveBeenCalledTimes(1);
		expect(requireViewerReadModel).toHaveBeenCalledWith(NO_ACCESSOR);
	});

	it('runs sheets strictly sequentially, in createSheetList (priority) order', async () => {
		const events: string[] = [];
		let resolveA: () => void = () => {};
		const aGate = new Promise<void>((resolve) => {
			resolveA = resolve;
		});

		const { sheets } = makeFakeSheets();
		const runPromise = createSheets({
			sheets,
			accessor: NO_ACCESSOR,
			reports: [],
			createSheetList: [
				makeCreateSheet({
					name: 'A',
					createHeaders: () => ['A', 'B'],
					estimateRowCount: () => Promise.resolve(0),
					run: async () => {
						events.push('A:start');
						await aGate;
						events.push('A:end');
					},
				}),
				makeCreateSheet({
					name: 'B',
					createHeaders: () => ['A', 'B'],
					estimateRowCount: () => Promise.resolve(0),
					run: () => {
						events.push('B:start');
						return Promise.resolve();
					},
				}),
			],
			options: { silent: true },
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(events).toEqual(['A:start']);

		resolveA();
		await runPromise;
		expect(events).toEqual(['A:start', 'A:end', 'B:start']);
	});

	it('rolls the unused portion of one sheet budget over to the next sheet', async () => {
		const { sheets, getMock } = makeFakeSheets();
		const receivedMaxRows: Record<string, number> = {};

		/**
		 * Builds a `run()` that records its own `ctx.maxRows` and sends a
		 * fixed number of rows, for asserting the budget rollover.
		 * @param name - Key to record the received `maxRows` under.
		 * @param rowsToSend - Number of rows this sheet actually sends.
		 */
		function run(name: string, rowsToSend: number) {
			return async (ctx: RunSheetContext) => {
				receivedMaxRows[name] = ctx.maxRows;
				for (let i = 0; i < rowsToSend; i++) {
					await ctx.sheet.appendRow(ROW);
				}
				ctx.onProgress(rowsToSend, rowsToSend);
			};
		}

		// CELL_BUDGET_LIMIT is mocked to 8. Two 2-column sheets: header cost
		// 2+2=4, leaving 4 cells (= 2 rows) for Phase 2's initial allocation.
		await createSheets({
			sheets,
			accessor: NO_ACCESSOR,
			reports: [],
			createSheetList: [
				makeCreateSheet({
					name: 'A',
					createHeaders: () => ['col1', 'col2'],
					estimateRowCount: () => Promise.resolve(5),
					run: run('A', 1), // sends fewer rows than its allocation
				}),
				makeCreateSheet({
					name: 'B',
					createHeaders: () => ['col1', 'col2'],
					estimateRowCount: () => Promise.resolve(5),
					run: run('B', 0),
				}),
			],
			options: { silent: true },
		});

		expect(receivedMaxRows.A).toBe(2); // floor(4 / 2)
		expect(getMock('A')?.rows).toHaveLength(1);
		// A only spent 1 row * 2 cols = 2 cells, leaving 2 of the original 4 —
		// plus B never spent any of its own headroom, so B should see the
		// leftover, not a budget already used up by A's un-sent allocation.
		expect(receivedMaxRows.B).toBe(1); // floor((4 - 1*2) / 2)
	});

	it('appends a TRUNCATED marker row and warns when a sheet is cut off at its budget', async () => {
		const { sheets, getMock } = makeFakeSheets();
		const onWarn = vi.fn();

		await createSheets({
			sheets,
			accessor: NO_ACCESSOR,
			reports: [],
			createSheetList: [
				makeCreateSheet({
					name: 'Big Sheet',
					createHeaders: () => ['col1', 'col2'],
					estimateRowCount: () => Promise.resolve(100), // far exceeds the mocked budget
					run: async (ctx) => {
						for (let i = 0; i < ctx.maxRows; i++) {
							await ctx.sheet.appendRow(ROW);
						}
						ctx.onProgress(ctx.maxRows, 100);
					},
				}),
			],
			options: { onWarn, silent: true },
		});

		// CELL_BUDGET_LIMIT=8, one 2-column sheet: header cost 2, remaining 6,
		// maxRows = floor(6/2) = 3 data rows + 1 TRUNCATED marker row.
		const mock = getMock('Big Sheet')!;
		expect(mock.rows).toHaveLength(4);
		expect(onWarn).toHaveBeenCalledWith(expect.stringContaining('truncated at 3 rows'));
	});

	it('still marks a sheet truncated when it is only cut off live — not by the Phase 1.5 advisory estimate', async () => {
		// CELL_BUDGET_LIMIT is mocked to 8. Both sheets have 1 column, so
		// header cost is 2, leaving 6 cells for Phase 2's live allocation.
		//
		// The Phase 1.5 *advisory* pass caps each sheet's assumed
		// consumption at its own `estimateRowCount()`, so it predicts:
		// A takes 2 (its estimate), leaving 4 for B, and B's estimate (3)
		// fits within that 4 -> advisory says B is NOT truncated.
		//
		// But Phase 2's real `maxRows` for A is NOT capped by A's estimate
		// (only by the live budget) — if A's real data actually has more
		// rows than its `estimateRowCount()` predicted (a plausible
		// COUNT(*)-vs-stream discrepancy) and A sends 5 real rows, B is
		// really left with only 1 cell's worth of budget, cutting it off
		// for real despite the stale advisory saying it wouldn't be.
		const { sheets, getMock } = makeFakeSheets();
		const onWarn = vi.fn();

		await createSheets({
			sheets,
			accessor: NO_ACCESSOR,
			reports: [],
			createSheetList: [
				makeCreateSheet({
					name: 'A',
					createHeaders: () => ['col1'],
					estimateRowCount: () => Promise.resolve(2), // undercounts the real data
					run: async (ctx) => {
						for (let i = 0; i < 5; i++) {
							await ctx.sheet.appendRow(ROW);
						}
						ctx.onProgress(5, 5);
					},
				}),
				makeCreateSheet({
					name: 'B',
					createHeaders: () => ['col1'],
					estimateRowCount: () => Promise.resolve(3),
					run: async (ctx) => {
						for (let i = 0; i < ctx.maxRows; i++) {
							await ctx.sheet.appendRow(ROW);
						}
						ctx.onProgress(ctx.maxRows, 3);
					},
				}),
			],
			options: { onWarn, silent: true },
		});

		expect(getMock('B')?.rows).toHaveLength(2); // 1 real data row + 1 TRUNCATED marker
		expect(onWarn).toHaveBeenCalledWith(
			expect.stringContaining('"B" was truncated at 1 rows'),
		);
	});

	it('skips a lower-priority sheet entirely once the cell budget is exhausted', async () => {
		const { sheets, getMock } = makeFakeSheets();
		const onWarn = vi.fn();
		const bRun = vi.fn(() => Promise.resolve());

		await createSheets({
			sheets,
			accessor: NO_ACCESSOR,
			reports: [],
			createSheetList: [
				makeCreateSheet({
					name: 'A',
					createHeaders: () => ['col1', 'col2'],
					estimateRowCount: () => Promise.resolve(2),
					run: async (ctx) => {
						for (let i = 0; i < ctx.maxRows; i++) {
							await ctx.sheet.appendRow(ROW);
						}
						ctx.onProgress(ctx.maxRows, 2);
					},
				}),
				makeCreateSheet({
					name: 'B',
					createHeaders: () => ['col1', 'col2'],
					estimateRowCount: () => Promise.resolve(2),
					run: bRun,
				}),
			],
			options: { onWarn, silent: true },
		});

		// Budget 8, header cost 4, remaining 4 -> A gets maxRows=2 and consumes
		// it fully (2 rows * 2 cols = 4 cells), leaving 0 for B.
		expect(getMock('A')?.rows).toHaveLength(2);
		expect(bRun).not.toHaveBeenCalled();
		// Phase 1 still creates "B" and sets its headers unconditionally —
		// only Phase 2's row generation is skipped.
		expect(getMock('B')?.rows).toHaveLength(0);
		expect(onWarn).toHaveBeenCalledWith(expect.stringContaining('skipped entirely'));
	});

	it('shows an immediate "uploading" message and real per-chunk progress during Upload', async () => {
		// The Process step never calls the real flush() (it's deferred to
		// Upload) — Upload must both (a) say something the instant it starts
		// (flush() can be a single, multi-second network call with no
		// progress signal until it resolves) and (b) show real numbers
		// (via Sheet.onProgress) for a multi-chunk flush, not a static
		// "uploading..." the whole time.
		const chunks: string[] = [];
		const stream = {
			write: (chunk: string) => {
				chunks.push(String(chunk));
				return true;
			},
		} as never;

		let onProgressHandler: ((sent: number, remaining: number) => void) | undefined;
		const fakeSheet = {
			setHeaders: () => Promise.resolve(),
			appendRow: () => Promise.resolve(),
			flush: () => {
				// Simulate two chunk completions, as a real multi-chunk
				// upload (e.g. dedupe mode's single large appendRow) would.
				onProgressHandler?.(2000, 500);
				onProgressHandler?.(2500, 0);
				return Promise.resolve();
			},
			get sentCount() {
				return 2500;
			},
			set onProgress(fn: ((sent: number, remaining: number) => void) | undefined) {
				onProgressHandler = fn;
			},
		} as never;
		const sheets = { create: () => Promise.resolve(fakeSheet) } as never;

		await createSheets({
			sheets,
			accessor: NO_ACCESSOR,
			reports: [],
			createSheetList: [
				makeCreateSheet({
					name: 'A',
					createHeaders: () => ['col1'],
					estimateRowCount: () => Promise.resolve(2500),
					run: () => Promise.resolve(),
				}),
			],
			options: { stream, verbose: true },
		});

		const output = chunks.join('');
		expect(output).toContain('uploading to Google Sheets...');
		expect(output).toContain('2,000/2,500 rows (80%)');
		expect(output).toContain('2,500/2,500 rows (100%)');
	});

	it('routes Google Sheets API rate-limit backoff messages to the currently running step', async () => {
		const { sheets } = makeFakeSheets();
		const chunks: string[] = [];
		const stream = {
			write: (chunk: string) => {
				chunks.push(String(chunk));
				return true;
			},
		} as never;

		await createSheets({
			sheets,
			accessor: NO_ACCESSOR,
			reports: [],
			createSheetList: [
				makeCreateSheet({
					name: 'A',
					createHeaders: () => ['col1'],
					estimateRowCount: () => Promise.resolve(0),
					run: () => {
						// Simulate the Sheets client reporting a rate-limit wait
						// while this sheet's "Process" step is the active row.
						(sheets as { onLog?: (message: unknown) => void }).onLog?.({
							message: 'TooManyRequestError',
							waiting: true,
							waitTime: 5000,
							code: '429',
						});
						return Promise.resolve();
					},
				}),
			],
			options: { stream, verbose: true },
		});

		expect(chunks.join('')).toContain('Too Many Requests (429)');
	});

	it('calls updateSheet only for sheets that define it, after every run() has completed', async () => {
		const { sheets } = makeFakeSheets();
		const updateA = vi.fn(() => Promise.resolve());

		await createSheets({
			sheets,
			accessor: NO_ACCESSOR,
			reports: [],
			createSheetList: [
				makeCreateSheet({
					name: 'A',
					createHeaders: () => ['col1', 'col2'],
					estimateRowCount: () => Promise.resolve(0),
					run: () => Promise.resolve(),
					updateSheet: updateA,
				}),
				makeCreateSheet({
					name: 'B',
					createHeaders: () => ['col1', 'col2'],
					estimateRowCount: () => Promise.resolve(0),
					run: () => Promise.resolve(),
				}),
			],
			options: { silent: true },
		});

		expect(updateA).toHaveBeenCalledTimes(1);
	});
});
