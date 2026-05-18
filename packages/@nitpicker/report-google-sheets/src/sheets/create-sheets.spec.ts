import type { CreateSheet, CreateSheetSetting } from './types.js';
import type { Cell, Sheet, Sheets } from '@d-zero/google-sheets';
import type { Archive, ArchiveResource, Page } from '@nitpicker/crawler';

import { describe, it, expect, vi } from 'vitest';

import { createSheets } from './create-sheets.js';

/**
 * Constructs a minimal Cell stub. The streamer/sender treat cells as
 * opaque payloads, so the value doesn't matter for these tests.
 */
function fakeCell(): Cell {
	return { provide: () => ({}) } as unknown as Cell;
}

/**
 * Builds a fake Sheets object whose `create()` returns a fresh per-name
 * Sheet stub, and records every `addRowData` call on each sheet so tests
 * can assert on the chunking pattern.
 */
function createFakeSheets() {
	const sheetCalls = new Map<string, Cell[][][]>();
	const sheets = {
		create: vi.fn((name: string): Promise<Sheet> => {
			let calls = sheetCalls.get(name);
			if (!calls) {
				calls = [];
				sheetCalls.set(name, calls);
			}
			const recordedCalls = calls;
			const sheet = {
				addRowData: vi.fn((data: Cell[][]) => {
					recordedCalls.push([...data]);
					return Promise.resolve();
				}),
				setHeaders: vi.fn(() => Promise.resolve()),
				frozen: vi.fn(() => Promise.resolve()),
				conditionalFormat: vi.fn(() => Promise.resolve()),
				hideCol: vi.fn(() => Promise.resolve()),
				overwriteHeaderFormat: vi.fn(() => Promise.resolve()),
				getColNumByHeaderName: vi.fn(() => 0),
			} as unknown as Sheet;
			return Promise.resolve(sheet);
		}),
	} as unknown as Sheets;
	return { sheets, sheetCalls };
}

/**
 * Builds a fake Archive whose `getPagesWithRefs` yields the given pages
 * in a single batch and whose `getResources` yields the given resources.
 * @param pages - Pages to deliver to the callback.
 * @param resources - Resources to return from getResources().
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
 * Builds an array of `count` fake Page objects. Tests only need the
 * objects to be distinct references; their internal shape is irrelevant
 * because the eachPage handlers in these tests don't read any fields.
 * @param count - Number of pages to construct.
 */
function fakePages(count: number): Page[] {
	return Array.from({ length: count }, (_, i) => ({ index: i }) as unknown as Page);
}

describe('createSheets', () => {
	it('streams rows incrementally for settings without bufferRows (memory fix path)', async () => {
		// Streaming setting emits 1 row per page. With 3000 pages and
		// SEND_CHUNK_SIZE=2500, the streamer must flush once at 2500 rows
		// (mid-iteration) and once again at flush() with the remaining 500.
		const setting: CreateSheetSetting = {
			name: 'StreamingSheet',
			createHeaders: () => ['col'],
			eachPage: () => [[fakeCell()]],
		};
		const create: CreateSheet = () => setting;
		const { sheets, sheetCalls } = createFakeSheets();
		const archive = createFakeArchive(fakePages(3000));

		await createSheets({
			sheets,
			archive,
			reports: [],
			limit: 100_000,
			createSheetList: [create],
		});

		const calls = sheetCalls.get('StreamingSheet');
		// 1 streamed chunk (2500) + 1 flush (500). setHeaders is mocked
		// independently here, so it doesn't reach addRowData.
		expect(calls).toBeDefined();
		expect(calls!.map((c) => c.length)).toEqual([2500, 500]);
	});

	it('buffers all rows until end of batch for settings with bufferRows: true', async () => {
		// Buffered setting emits 1 row per page across 3000 pages. The
		// existing sendRowsInChunks() splits at SEND_CHUNK_SIZE, but the
		// key difference vs streaming is that NO addRowData call happens
		// until the final page is processed: all 3000 rows accumulate first.
		const eachPageCalls: number[] = [];
		const addRowDataOrder: { phase: 'eachPage' | 'send'; pageOrSize: number }[] = [];
		const setting: CreateSheetSetting = {
			name: 'BufferedSheet',
			bufferRows: true,
			createHeaders: () => ['col'],
			eachPage: (_page, num) => {
				eachPageCalls.push(num);
				addRowDataOrder.push({ phase: 'eachPage', pageOrSize: num });
				return [[fakeCell()]];
			},
		};
		const create: CreateSheet = () => setting;

		// Replace the fake sheet's addRowData so we can interleave its
		// invocation order with eachPage calls. Streaming would invoke
		// addRowData mid-iteration; buffering would only invoke it after
		// all eachPage calls have completed.
		const sheets = {
			create: vi.fn((name: string): Promise<Sheet> => {
				const sheet = {
					addRowData: vi.fn((data: Cell[][]) => {
						if (name === 'BufferedSheet') {
							addRowDataOrder.push({ phase: 'send', pageOrSize: data.length });
						}
						return Promise.resolve();
					}),
					setHeaders: vi.fn(() => Promise.resolve()),
				} as unknown as Sheet;
				return Promise.resolve(sheet);
			}),
		} as unknown as Sheets;
		const archive = createFakeArchive(fakePages(3000));

		await createSheets({
			sheets,
			archive,
			reports: [],
			limit: 100_000,
			createSheetList: [create],
		});

		expect(eachPageCalls).toHaveLength(3000);
		// All eachPage entries appear before any 'send' entry — proves buffering.
		const firstSendIndex = addRowDataOrder.findIndex((e) => e.phase === 'send');
		const lastEachPageIndex = addRowDataOrder.findLastIndex(
			(e) => e.phase === 'eachPage',
		);
		expect(firstSendIndex).toBeGreaterThan(lastEachPageIndex);
		// The buffered send is then chunked into 2500 + 500 by sendRowsInChunks.
		const sends = addRowDataOrder.filter((e) => e.phase === 'send');
		expect(sends.map((s) => s.pageOrSize)).toEqual([2500, 500]);
	});

	it('handles streaming and buffered settings together in one batch', async () => {
		// Both settings iterate the same pages array via Promise.all.
		// Streaming flushes mid-iteration; buffered flushes at the end.
		// Neither should interfere with the other.
		const streaming: CreateSheetSetting = {
			name: 'Streamed',
			createHeaders: () => ['c'],
			eachPage: () => [[fakeCell()]],
		};
		const buffered: CreateSheetSetting = {
			name: 'Buffered',
			bufferRows: true,
			createHeaders: () => ['c'],
			eachPage: () => [[fakeCell()]],
		};
		const { sheets, sheetCalls } = createFakeSheets();
		const archive = createFakeArchive(fakePages(2600));

		await createSheets({
			sheets,
			archive,
			reports: [],
			limit: 100_000,
			createSheetList: [() => streaming, () => buffered],
		});

		// Streaming: 1 mid-flush (2500) + 1 final flush (100).
		const streamedCalls = sheetCalls.get('Streamed')!;
		expect(streamedCalls.map((c) => c.length)).toEqual([2500, 100]);
		// Buffered: 2 chunks (2500 + 100), but both chunks land after
		// iteration completes (verified by the dedicated test).
		const bufferedCalls = sheetCalls.get('Buffered')!;
		expect(bufferedCalls.map((c) => c.length)).toEqual([2500, 100]);
	});

	it('streams eachResource rows in Phase 3', async () => {
		// Phase 3 has no buffered path — all eachResource settings stream.
		const setting: CreateSheetSetting = {
			name: 'ResourceSheet',
			createHeaders: () => ['c'],
			eachResource: () => [[fakeCell()]],
		};
		const { sheets, sheetCalls } = createFakeSheets();
		const fakeResources = Array.from(
			{ length: 5000 },
			(_, i) => ({ index: i }) as unknown as ArchiveResource,
		);
		const archive = createFakeArchive([], fakeResources);

		await createSheets({
			sheets,
			archive,
			reports: [],
			limit: 100_000,
			createSheetList: [() => setting],
		});

		const calls = sheetCalls.get('ResourceSheet')!;
		// 2 mid-flush chunks (2500 + 2500). 5000 / 2500 = 2 with no remainder
		// so the final flush() is a no-op.
		expect(calls.map((c) => c.length)).toEqual([2500, 2500]);
	});

	it('does not call addRowData for resources when getResources() returns empty', async () => {
		// Phase 3 entered with no resources: streamer.push is never called,
		// streamer.flush() is a no-op, so addRowData is only called for the
		// setHeaders row at sheet creation.
		const setting: CreateSheetSetting = {
			name: 'EmptyResource',
			createHeaders: () => ['c'],
			eachResource: () => [[fakeCell()]],
		};
		const { sheets, sheetCalls } = createFakeSheets();
		const archive = createFakeArchive([], []);

		await createSheets({
			sheets,
			archive,
			reports: [],
			limit: 100_000,
			createSheetList: [() => setting],
		});

		const calls = sheetCalls.get('EmptyResource');
		// addRowData is never called: setHeaders is mocked separately and
		// the streamer's push/flush never run. The bucket exists (because
		// sheets.create() was invoked) but holds no recorded calls.
		expect(calls).toEqual([]);
	});

	it('skips pages whose eachPage returns null without growing the buffer', async () => {
		// Streaming path with a setting that returns null for half the pages.
		// Buffer should only grow by 1 per non-null page.
		let pageNum = 0;
		const setting: CreateSheetSetting = {
			name: 'SkipsHalf',
			createHeaders: () => ['c'],
			eachPage: () => {
				pageNum++;
				return pageNum % 2 === 0 ? null : [[fakeCell()]];
			},
		};
		const { sheets, sheetCalls } = createFakeSheets();
		const archive = createFakeArchive(fakePages(5001));

		await createSheets({
			sheets,
			archive,
			reports: [],
			limit: 100_000,
			createSheetList: [() => setting],
		});

		const calls = sheetCalls.get('SkipsHalf')!;
		// 5001 pages, every other one skipped → 2501 emitted rows.
		// 1 mid-flush (2500) + 1 final flush (1).
		expect(calls.map((c) => c.length)).toEqual([2500, 1]);
	});

	it('still calls addRowData via sendRowsInChunks for buffered settings even when row count is below SEND_CHUNK_SIZE', async () => {
		// Buffered path with a small row count: single addRowData for all rows.
		const setting: CreateSheetSetting = {
			name: 'SmallBuffered',
			bufferRows: true,
			createHeaders: () => ['c'],
			eachPage: () => [[fakeCell()]],
		};
		const { sheets, sheetCalls } = createFakeSheets();
		const archive = createFakeArchive(fakePages(100));

		await createSheets({
			sheets,
			archive,
			reports: [],
			limit: 100_000,
			createSheetList: [() => setting],
		});

		const calls = sheetCalls.get('SmallBuffered')!;
		// 1 send-all (100 rows). sendRowsInChunks emits a single addRowData
		// when the row count is at or below SEND_CHUNK_SIZE.
		expect(calls.map((c) => c.length)).toEqual([100]);
	});
});
