import type { CreateSheetSetting } from './types.js';
import type { Lanes } from '@d-zero/dealer';
import type { Cell, Sheet } from '@d-zero/google-sheets';

import { describe, it, expect, vi } from 'vitest';

import { runFinalizeResources } from './run-finalize-resources.js';

/**
 * Minimal `Sheet` surface that `runFinalizeResources` actually touches.
 * Allows the tests to mock only the relevant subset.
 */
interface FakeSheet {
	/** `onProgress` callback slot; set/reset by the function under test. */
	onProgress?: (sent: number, remaining: number) => void | Promise<void>;
	/** Cumulative count of rows sent (unused by the function under test, kept for type parity). */
	sentCount: number;
	/** Stand-in for the real streaming send. */
	appendRow: (...rows: readonly Cell[][]) => Promise<void>;
}

/**
 * Signature for the user-supplied `appendRow` body: it can fire
 * `this.onProgress` and either return synchronously or asynchronously.
 */
type AppendRowImpl = (
	this: FakeSheet,
	...rows: readonly Cell[][]
) => void | Promise<void>;

/**
 * Builds a fake `Sheet` whose `appendRow` runs the given implementation
 * with `this` bound to the fake (so the impl can fire `onProgress`).
 * @param appendRowImpl - Implementation invoked when `appendRow` is called.
 */
function makeFakeSheet(appendRowImpl: AppendRowImpl = () => {}): FakeSheet {
	const sheet: FakeSheet = {
		onProgress: undefined,
		sentCount: 0,
		appendRow: vi.fn(function (this: FakeSheet, ...rows: readonly Cell[][]) {
			return Promise.resolve(appendRowImpl.apply(this, rows));
		}),
	};
	return sheet;
}

/**
 * Minimal `Lanes` shape that records `update` / `header` calls.
 */
interface FakeLanes {
	/** Spy that captures `(id, log)` updates. */
	update: ReturnType<typeof vi.fn>;
	/** Spy that captures header changes. */
	header: ReturnType<typeof vi.fn>;
}

/**
 * Builds a fresh fake Lanes instance whose method calls can be inspected
 * via `.mock.calls` after the function under test runs.
 */
function makeFakeLanes(): FakeLanes {
	return {
		update: vi.fn(),
		header: vi.fn(),
	};
}

/**
 * Builds a `CreateSheetSetting` with sensible defaults and the given overrides.
 * @param overrides - Properties to merge over the defaults.
 */
function makeSetting(overrides: Partial<CreateSheetSetting>): CreateSheetSetting {
	return {
		name: 'TestSheet',
		createHeaders: () => [],
		...overrides,
	};
}

describe('runFinalizeResources', () => {
	it('finalizeResources hook が無いシートでは何もしない', async () => {
		const sheet = makeFakeSheet();
		const lanes = makeFakeLanes();
		const setting = makeSetting({});

		await runFinalizeResources({
			setting,
			sheet: sheet as unknown as Sheet,
			lanes: lanes as unknown as Lanes,
			laneId: 0,
			sheetName: 'TestSheet',
		});

		expect(sheet.appendRow).not.toHaveBeenCalled();
		expect(sheet.onProgress).toBeUndefined();
		expect(lanes.update).not.toHaveBeenCalled();
	});

	it('finalizeResources が空配列を返す場合は appendRow を呼ばず onProgress も設定しない', async () => {
		const sheet = makeFakeSheet();
		const lanes = makeFakeLanes();
		const setting = makeSetting({
			finalizeResources: vi.fn(() => [] as Cell[][]),
		});

		await runFinalizeResources({
			setting,
			sheet: sheet as unknown as Sheet,
			lanes: lanes as unknown as Lanes,
			laneId: 0,
			sheetName: 'TestSheet',
		});

		expect(sheet.appendRow).not.toHaveBeenCalled();
		expect(sheet.onProgress).toBeUndefined();
		expect(lanes.update).toHaveBeenCalledTimes(1);
		expect(lanes.update).toHaveBeenCalledWith(
			0,
			'TestSheet: Finalizing aggregated rows%dots%',
		);
	});

	it('finalizeResources が null を返す場合も appendRow を呼ばない', async () => {
		const sheet = makeFakeSheet();
		const lanes = makeFakeLanes();
		const setting = makeSetting({
			finalizeResources: vi.fn(() => null),
		});

		await runFinalizeResources({
			setting,
			sheet: sheet as unknown as Sheet,
			lanes: lanes as unknown as Lanes,
			laneId: 0,
			sheetName: 'TestSheet',
		});

		expect(sheet.appendRow).not.toHaveBeenCalled();
		expect(sheet.onProgress).toBeUndefined();
	});

	it('chunk flush ごとに onProgress 経由で Lanes が更新される', async () => {
		const lanes = makeFakeLanes();
		// 本番では 60K 行クラスが一括で `appendRow(...finalRows)` に渡されるが、
		// テストではスプレッドの引数数を V8 の関数引数制限内に抑えるため
		// 100 件で同等の挙動を検証する。total/sent の数字が表示文字列に
		// そのまま埋め込まれるロジックは件数に依存しない。
		const finalRows: Cell[][] = Array.from({ length: 100 }, () => []);
		const setting = makeSetting({
			finalizeResources: vi.fn(() => finalRows),
		});

		const sheet = makeFakeSheet(function (this: FakeSheet, ...rows) {
			void this.onProgress?.(25, rows.length - 25);
			void this.onProgress?.(75, rows.length - 75);
			void this.onProgress?.(rows.length, 0);
		});

		await runFinalizeResources({
			setting,
			sheet: sheet as unknown as Sheet,
			lanes: lanes as unknown as Lanes,
			laneId: 5,
			sheetName: 'Resources',
		});

		const messages = lanes.update.mock.calls.map((call) => call[1]);
		expect(messages).toEqual([
			'Resources: Finalizing aggregated rows%dots%',
			'Resources: Sending 0/100 aggregated rows%dots%',
			'Resources: Sending 25/100 aggregated rows%dots%',
			'Resources: Sending 75/100 aggregated rows%dots%',
			'Resources: Sending 100/100 aggregated rows%dots%',
		]);
		const laneIds = new Set(lanes.update.mock.calls.map((call) => call[0]));
		expect(laneIds).toEqual(new Set([5]));
		expect(sheet.onProgress).toBeUndefined();
	});

	it('appendRow が throw しても finally で onProgress が undefined にリセットされる', async () => {
		const lanes = makeFakeLanes();
		const setting = makeSetting({
			finalizeResources: vi.fn(() => [[]] as Cell[][]),
		});

		const sheet = makeFakeSheet(() => {
			throw new Error('boom');
		});

		await expect(
			runFinalizeResources({
				setting,
				sheet: sheet as unknown as Sheet,
				lanes: lanes as unknown as Lanes,
				laneId: 0,
				sheetName: 'TestSheet',
			}),
		).rejects.toThrow('boom');

		expect(sheet.onProgress).toBeUndefined();
	});

	it('lanes が undefined でも安全に動作する', async () => {
		const setting = makeSetting({
			finalizeResources: vi.fn(() => [[]] as Cell[][]),
		});

		const sheet = makeFakeSheet();

		await runFinalizeResources({
			setting,
			sheet: sheet as unknown as Sheet,
			lanes: undefined,
			laneId: 0,
			sheetName: 'TestSheet',
		});

		expect(sheet.appendRow).toHaveBeenCalledTimes(1);
		expect(sheet.onProgress).toBeUndefined();
	});
});
