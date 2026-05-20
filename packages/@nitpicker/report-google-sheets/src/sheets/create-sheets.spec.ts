import type { CreateSheet, CreateSheetSetting } from './types.js';
import type { Cell, Sheet, Sheets } from '@d-zero/google-sheets';
import type { Archive, ArchiveResource, Page } from '@nitpicker/crawler';

import { describe, it, expect, vi } from 'vitest';

import { createSheets } from './create-sheets.js';

/**
 * Records of one sheet's interactions with `appendRow` / `flush`.
 *
 * `appendRowBatches` captures each `appendRow(...rows)` call as an array of
 * the rows passed in (the caller's argv after the rest spread). `flushCount`
 * tracks the number of `flush()` invocations. Both let tests assert that
 * `createSheets()` is delegating the streaming responsibility to the Sheet
 * API rather than buffering rows in its own code path.
 */
interface SheetRecord {
	appendRowBatches: Cell[][][];
	flushCount: number;
}

/**
 * Constructs a minimal Cell stub. The Sheet stub treats cells as opaque
 * payloads, so any object exposing `provide()` is sufficient.
 */
function fakeCell(): Cell {
	return { provide: () => ({}) } as unknown as Cell;
}

/**
 * Builds a fake Sheets object whose `create()` returns a per-name cached
 * Sheet stub (matching the real `Sheets.create()` caching contract so the
 * second call for the same name returns the same instance). Each stub
 * records its `appendRow` argv lists and `flush` invocation count.
 */
function createFakeSheets() {
	const records = new Map<string, SheetRecord>();
	const sheetCache = new Map<string, Sheet>();
	const sheets = {
		create: vi.fn((name: string): Promise<Sheet> => {
			const cached = sheetCache.get(name);
			if (cached) {
				return Promise.resolve(cached);
			}
			const record: SheetRecord = { appendRowBatches: [], flushCount: 0 };
			records.set(name, record);
			let sentCount = 0;
			const sheet = {
				appendRow: vi.fn((...rows: Cell[][]) => {
					record.appendRowBatches.push(rows);
					sentCount += rows.length;
					return Promise.resolve();
				}),
				flush: vi.fn(() => {
					record.flushCount++;
					return Promise.resolve();
				}),
				get sentCount() {
					return sentCount;
				},
				setHeaders: vi.fn(() => Promise.resolve()),
				frozen: vi.fn(() => Promise.resolve()),
				conditionalFormat: vi.fn(() => Promise.resolve()),
				hideCol: vi.fn(() => Promise.resolve()),
				overwriteHeaderFormat: vi.fn(() => Promise.resolve()),
				getColNumByHeaderName: vi.fn(() => 0),
			} as unknown as Sheet;
			sheetCache.set(name, sheet);
			return Promise.resolve(sheet);
		}),
	} as unknown as Sheets;
	return { sheets, records };
}

/**
 * Builds a fake Archive whose `getPagesWithRefs` yields the given pages
 * in a single batch and whose `getResources` yields the given resources.
 * @param pages - Pages to deliver to the callback.
 * @param resources - Resources to return from `getResources()`.
 */
function createFakeArchive(pages: Page[], resources: ArchiveResource[] = []): Archive {
	return {
		getPagesWithRefs: vi.fn(
			async (
				_limit: number,
				cb: (pages: Page[], offset: number, max: number) => Promise<void> | void,
			) => {
				if (pages.length > 0) {
					await cb(pages, 0, pages.length);
				}
			},
		),
		getResources: vi.fn(() => Promise.resolve(resources)),
	} as unknown as Archive;
}

/**
 * Builds an array of `count` fake Page objects. Tests only need distinct
 * references; the page shape is irrelevant since the `eachPage` handlers
 * in these tests don't read any fields.
 * @param count - Number of pages to construct.
 */
function fakePages(count: number): Page[] {
	return Array.from({ length: count }, (_, i) => ({ index: i }) as unknown as Page);
}

describe('createSheets', () => {
	it('delegates Phase 2 row sending to sheet.appendRow + sheet.flush', async () => {
		// Each eachPage emission must reach sheet.appendRow exactly once with
		// the spread row data, and flush() must be invoked once at end of
		// the batch. This pins down the contract that streaming/chunking is
		// the Sheet API's responsibility, not createSheets'.
		const setting: CreateSheetSetting = {
			name: 'Streamed',
			createHeaders: () => ['col'],
			eachPage: () => [[fakeCell()]],
		};
		const create: CreateSheet = () => setting;
		const { sheets, records } = createFakeSheets();
		const archive = createFakeArchive(fakePages(3));

		await createSheets({
			sheets,
			archive,
			reports: [],
			limit: 100_000,
			createSheetList: [create],
		});

		const record = records.get('Streamed')!;
		// 3 eachPage emissions, each calling appendRow with 1 row.
		expect(record.appendRowBatches).toHaveLength(3);
		for (const batch of record.appendRowBatches) {
			expect(batch).toHaveLength(1);
		}
		expect(record.flushCount).toBe(1);
	});

	it('skips appendRow when eachPage returns null but still flushes at batch end', async () => {
		// A skip-by-null page must not consume an appendRow call. The end-of-
		// batch flush still fires so any earlier rows make it to the sheet.
		// Explicit per-call return values keep the test fixture free of
		// conditional logic (no ternaries / no modulo) — each invocation's
		// outcome is visible at a glance.
		const eachPage = vi
			.fn()
			.mockReturnValueOnce([[fakeCell()]])
			.mockReturnValueOnce(null)
			.mockReturnValueOnce([[fakeCell()]])
			.mockReturnValueOnce(null)
			.mockReturnValueOnce([[fakeCell()]]);
		const setting: CreateSheetSetting = {
			name: 'SkipsHalf',
			createHeaders: () => ['col'],
			eachPage,
		};
		const { sheets, records } = createFakeSheets();
		const archive = createFakeArchive(fakePages(5));

		await createSheets({
			sheets,
			archive,
			reports: [],
			limit: 100_000,
			createSheetList: [() => setting],
		});

		const record = records.get('SkipsHalf')!;
		// 3 of the 5 pages emit rows; the other 2 return null and are skipped.
		expect(record.appendRowBatches).toHaveLength(3);
		expect(record.flushCount).toBe(1);
	});

	it('forwards multi-row eachPage output through a single appendRow call', async () => {
		// eachPage can return multiple rows for a single page (e.g. Referrers
		// Relational Table emits one row per referrer). The spread must reach
		// appendRow as a single variadic call containing all rows.
		const setting: CreateSheetSetting = {
			name: 'MultiRow',
			createHeaders: () => ['col'],
			eachPage: () => [[fakeCell()], [fakeCell()], [fakeCell()]],
		};
		const { sheets, records } = createFakeSheets();
		const archive = createFakeArchive(fakePages(2));

		await createSheets({
			sheets,
			archive,
			reports: [],
			limit: 100_000,
			createSheetList: [() => setting],
		});

		const record = records.get('MultiRow')!;
		// 2 pages × 3 rows each = 2 appendRow calls, each with 3 rows.
		expect(record.appendRowBatches).toHaveLength(2);
		expect(record.appendRowBatches[0]).toHaveLength(3);
		expect(record.appendRowBatches[1]).toHaveLength(3);
		expect(record.flushCount).toBe(1);
	});

	it('streams Phase 3 resources through appendRow + flush', async () => {
		// Same contract as Phase 2 but for eachResource iteration.
		const setting: CreateSheetSetting = {
			name: 'ResourceSheet',
			createHeaders: () => ['c'],
			eachResource: () => [[fakeCell()]],
		};
		const { sheets, records } = createFakeSheets();
		const fakeResources = Array.from(
			{ length: 4 },
			(_, i) =>
				({ url: `https://x.example/r-${i}`, index: i }) as unknown as ArchiveResource,
		);
		const archive = createFakeArchive([], fakeResources);

		await createSheets({
			sheets,
			archive,
			reports: [],
			limit: 100_000,
			createSheetList: [() => setting],
		});

		const record = records.get('ResourceSheet')!;
		expect(record.appendRowBatches).toHaveLength(4);
		expect(record.flushCount).toBe(1);
	});

	it('skips appendRow entirely when getResources() returns empty (but does not crash)', async () => {
		// Phase 3 with no resources: the eachResource loop body never runs,
		// so appendRow is never called. flush() still fires as a uniform
		// end-of-phase signal (no-op on an empty buffer per @d-zero/google-sheets).
		const setting: CreateSheetSetting = {
			name: 'EmptyResource',
			createHeaders: () => ['c'],
			eachResource: () => [[fakeCell()]],
		};
		const { sheets, records } = createFakeSheets();
		const archive = createFakeArchive([], []);

		await createSheets({
			sheets,
			archive,
			reports: [],
			limit: 100_000,
			createSheetList: [() => setting],
		});

		const record = records.get('EmptyResource')!;
		expect(record.appendRowBatches).toHaveLength(0);
		expect(record.flushCount).toBe(1);
	});

	it('runs preEachPage hooks before eachPage hooks within the same batch', async () => {
		// Settings with preEachPage are state-accumulators (e.g. building
		// index maps that eachPage thunks read later). They must run to
		// completion across all pages before any eachPage hook starts.
		const calls: string[] = [];
		const preSetting: CreateSheetSetting = {
			name: 'Pre',
			createHeaders: () => ['c'],
			preEachPage: () => {
				calls.push('pre');
			},
		};
		const eachSetting: CreateSheetSetting = {
			name: 'Each',
			createHeaders: () => ['c'],
			eachPage: () => {
				calls.push('each');
				return [[fakeCell()]];
			},
		};
		const { sheets } = createFakeSheets();
		const archive = createFakeArchive(fakePages(2));

		await createSheets({
			sheets,
			archive,
			reports: [],
			limit: 100_000,
			createSheetList: [() => preSetting, () => eachSetting],
		});

		// preEachPage runs for both pages first, then eachPage runs for both.
		expect(calls).toEqual(['pre', 'pre', 'each', 'each']);
	});

	it('sends Phase 4 addRows data via appendRow + flush', async () => {
		// addRows produces a full Cell[][] up front (no iteration). It must
		// still funnel through appendRow + flush so the sheet's chunking
		// machinery applies uniformly across all phases.
		const setting: CreateSheetSetting = {
			name: 'Plugin',
			createHeaders: () => ['c'],
			addRows: () => [[fakeCell()], [fakeCell()], [fakeCell()]],
		};
		const { sheets, records } = createFakeSheets();
		const archive = createFakeArchive([]);

		await createSheets({
			sheets,
			archive,
			reports: [],
			limit: 100_000,
			createSheetList: [() => setting],
		});

		const record = records.get('Plugin')!;
		// addRows produced 3 rows in one go; appendRow receives all 3 via spread.
		expect(record.appendRowBatches).toHaveLength(1);
		expect(record.appendRowBatches[0]).toHaveLength(3);
		expect(record.flushCount).toBe(1);
	});

	it('passes Cell instances from eachPage through to appendRow without cloning', async () => {
		// Lazy detection in @d-zero/google-sheets relies on cell.provide
		// identity (cell.provide !== Cell.prototype.provide). createSheets()
		// must not clone, map, or wrap cells on the way to appendRow, or the
		// LazyCell signature on PageList's "Internal Referrers" column would
		// be lost and the auto-buffer would never trigger.
		const cellA = fakeCell();
		const cellB = fakeCell();
		const setting: CreateSheetSetting = {
			name: 'Identity',
			createHeaders: () => ['col'],
			eachPage: () => [[cellA, cellB]],
		};
		const { sheets, records } = createFakeSheets();
		const archive = createFakeArchive(fakePages(1));

		await createSheets({
			sheets,
			archive,
			reports: [],
			limit: 100_000,
			createSheetList: [() => setting],
		});

		const record = records.get('Identity')!;
		const row = record.appendRowBatches[0]![0]!;
		// Reference identity, not deep equality — the same Cell instances
		// must reach the sheet so the lazy detection's prototype check works.
		expect(row[0]).toBe(cellA);
		expect(row[1]).toBe(cellB);
	});

	it('passes Cell instances from eachResource through to appendRow without cloning', async () => {
		// Same invariant as Phase 2, but for Phase 3 (eachResource). Phase 3
		// does not currently emit lazy cells, but the same identity contract
		// must hold so a future lazy resource cell would be auto-buffered.
		const cellA = fakeCell();
		const setting: CreateSheetSetting = {
			name: 'IdentityResource',
			createHeaders: () => ['col'],
			eachResource: () => [[cellA]],
		};
		const { sheets, records } = createFakeSheets();
		const archive = createFakeArchive(
			[],
			[{ url: 'https://x.example/r-0', index: 0 } as unknown as ArchiveResource],
		);

		await createSheets({
			sheets,
			archive,
			reports: [],
			limit: 100_000,
			createSheetList: [() => setting],
		});

		const record = records.get('IdentityResource')!;
		expect(record.appendRowBatches[0]![0]![0]).toBe(cellA);
	});

	it('eachResource is called with each resource exactly once in order', async () => {
		const calls: ArchiveResource[] = [];
		const setting: CreateSheetSetting = {
			name: 'EachResourceContract',
			createHeaders: () => ['c'],
			eachResource: (resource) => {
				calls.push(resource);
				return [[fakeCell()]];
			},
		};
		const { sheets } = createFakeSheets();
		// Already in URL-natural-sort order: image-1 < image-2 < image-10 (numeric).
		const fakeResources = [
			{ url: 'https://x.example/image-1.jpg' },
			{ url: 'https://x.example/image-2.jpg' },
			{ url: 'https://x.example/image-10.jpg' },
		] as unknown as ArchiveResource[];
		const archive = createFakeArchive([], fakeResources);

		await createSheets({
			sheets,
			archive,
			reports: [],
			limit: 100_000,
			createSheetList: [() => setting],
		});

		expect(calls).toEqual(fakeResources);
	});

	it('Phase 3 sorts resources in URL-natural order before iterating eachResource', async () => {
		// Insert order from the archive is shuffled (image-10 first, then image-1,
		// then image-2). Phase 3 must reorder them to natural numeric order before
		// eachResource sees them.
		const calls: string[] = [];
		const setting: CreateSheetSetting = {
			name: 'NaturalSortContract',
			createHeaders: () => ['c'],
			eachResource: (resource) => {
				calls.push(resource.url);
				return [[fakeCell()]];
			},
		};
		const { sheets } = createFakeSheets();
		const fakeResources = [
			{ url: 'https://x.example/image-10.jpg' },
			{ url: 'https://x.example/image-1.jpg' },
			{ url: 'https://x.example/image-2.jpg' },
		] as unknown as ArchiveResource[];
		const archive = createFakeArchive([], fakeResources);

		await createSheets({
			sheets,
			archive,
			reports: [],
			limit: 100_000,
			createSheetList: [() => setting],
		});

		expect(calls).toEqual([
			'https://x.example/image-1.jpg',
			'https://x.example/image-2.jpg',
			'https://x.example/image-10.jpg',
		]);
	});

	it('finalizeResources runs exactly once after the eachResource loop and its rows are appended', async () => {
		const order: string[] = [];
		const finalRow = [fakeCell(), fakeCell()];
		const setting: CreateSheetSetting = {
			name: 'FinalizeRuns',
			createHeaders: () => ['c'],
			eachResource: () => {
				order.push('each');
				return null;
			},
			finalizeResources: () => {
				order.push('finalize');
				return [finalRow];
			},
		};
		const { sheets, records } = createFakeSheets();
		const fakeResources = Array.from(
			{ length: 3 },
			(_, i) =>
				({ url: `https://x.example/r-${i}`, index: i }) as unknown as ArchiveResource,
		);
		const archive = createFakeArchive([], fakeResources);

		await createSheets({
			sheets,
			archive,
			reports: [],
			limit: 100_000,
			createSheetList: [() => setting],
		});

		expect(order).toEqual(['each', 'each', 'each', 'finalize']);
		const record = records.get('FinalizeRuns')!;
		expect(record.appendRowBatches).toHaveLength(1);
		expect(record.appendRowBatches[0]).toEqual([finalRow]);
		expect(record.flushCount).toBe(1);
	});

	it('finalizeResources returning [] does not trigger an extra appendRow', async () => {
		const setting: CreateSheetSetting = {
			name: 'FinalizeEmpty',
			createHeaders: () => ['c'],
			eachResource: () => null,
			finalizeResources: () => [],
		};
		const { sheets, records } = createFakeSheets();
		const archive = createFakeArchive(
			[],
			[{ url: 'https://x.example/r-0', index: 0 } as unknown as ArchiveResource],
		);

		await createSheets({
			sheets,
			archive,
			reports: [],
			limit: 100_000,
			createSheetList: [() => setting],
		});

		const record = records.get('FinalizeEmpty')!;
		expect(record.appendRowBatches).toHaveLength(0);
		expect(record.flushCount).toBe(1);
	});

	it('finalizeResources returning null does not trigger an extra appendRow', async () => {
		const setting: CreateSheetSetting = {
			name: 'FinalizeNull',
			createHeaders: () => ['c'],
			eachResource: () => null,
			finalizeResources: () => null,
		};
		const { sheets, records } = createFakeSheets();
		const archive = createFakeArchive(
			[],
			[{ url: 'https://x.example/r-0', index: 0 } as unknown as ArchiveResource],
		);

		await createSheets({
			sheets,
			archive,
			reports: [],
			limit: 100_000,
			createSheetList: [() => setting],
		});

		const record = records.get('FinalizeNull')!;
		expect(record.appendRowBatches).toHaveLength(0);
		expect(record.flushCount).toBe(1);
	});

	it('finalizeResources still runs (and emits []) when getResources() returns empty', async () => {
		// Without resources, eachResource is never called, but finalizeResources
		// should still fire so accumulators can flush. Today's createResources
		// dedupe path returns [] in that case; this test pins that contract.
		let finalized = 0;
		const setting: CreateSheetSetting = {
			name: 'FinalizeEmptyArchive',
			createHeaders: () => ['c'],
			eachResource: () => null,
			finalizeResources: () => {
				finalized++;
				return [];
			},
		};
		const { sheets, records } = createFakeSheets();
		const archive = createFakeArchive([], []);

		await createSheets({
			sheets,
			archive,
			reports: [],
			limit: 100_000,
			createSheetList: [() => setting],
		});

		expect(finalized).toBe(1);
		const record = records.get('FinalizeEmptyArchive')!;
		expect(record.appendRowBatches).toHaveLength(0);
		expect(record.flushCount).toBe(1);
	});

	it('relies on Sheets.create caching so the same sheet instance is reused across phases', async () => {
		// Phase 1 creates each sheet, then Phase 2/3/4 call sheets.create()
		// again to retrieve it. Without caching, appendRow's per-sheet buffer
		// and sentCount would be lost between phases. This test makes the
		// dependency visible: if a future refactor stops caching, this fails.
		const setting: CreateSheetSetting = {
			name: 'Shared',
			createHeaders: () => ['c'],
			eachPage: () => [[fakeCell()]],
		};
		const { sheets } = createFakeSheets();
		const archive = createFakeArchive(fakePages(1));

		await createSheets({
			sheets,
			archive,
			reports: [],
			limit: 100_000,
			createSheetList: [() => setting],
		});

		const createMock = sheets.create as ReturnType<typeof vi.fn>;
		const callsForShared = createMock.mock.calls.filter(([name]) => name === 'Shared');
		// Phase 1 + Phase 2 = at least 2 calls. Each call must resolve to
		// the same Sheet instance for the buffering to make sense.
		expect(callsForShared.length).toBeGreaterThanOrEqual(2);
		const sheetInstances = await Promise.all(
			createMock.mock.results
				.filter((_, i) => createMock.mock.calls[i]![0] === 'Shared')
				.map((r) => r.value),
		);
		// All resolved sheets for the same name must be the same instance.
		const first = sheetInstances[0];
		for (const instance of sheetInstances) {
			expect(instance).toBe(first);
		}
	});
});
