import type { ErrorHandlerMessage } from '@d-zero/google-sheets';

import { Lanes } from '@d-zero/dealer';
import enquirer from 'enquirer';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { report } from './report.js';

vi.mock('@d-zero/google-auth', () => ({
	authentication: vi.fn().mockResolvedValue({}),
}));

const { capturedOnLog } = vi.hoisted(() => ({
	capturedOnLog: { current: null as null | ((message: unknown) => void) },
}));

vi.mock('@d-zero/google-sheets', () => ({
	Sheets: class {
		get onLog() {
			return capturedOnLog.current;
		}
		set onLog(fn: ((message: unknown) => void) | null) {
			capturedOnLog.current = fn;
		}
	},
}));

const { mockArchiveClose, mockRemoveSignalHandlers } = vi.hoisted(() => ({
	mockArchiveClose: vi.fn(),
	mockRemoveSignalHandlers: vi.fn(),
}));

vi.mock('./archive.js', () => ({
	getArchive: vi.fn().mockResolvedValue({
		archive: { close: mockArchiveClose },
		removeSignalHandlers: mockRemoveSignalHandlers,
	}),
}));

vi.mock('./load-config.js', () => ({
	loadConfig: vi.fn().mockResolvedValue({}),
}));

vi.mock('./reports/get-plugin-reports.js', () => ({
	getPluginReports: vi.fn().mockResolvedValue([]),
}));

vi.mock('./sheets/create-sheets.js', () => ({
	createSheets: vi.fn().mockResolvedValue(),
}));

vi.mock('./data/add-to-summary.js', () => ({
	addToSummary: vi.fn().mockResolvedValue(),
}));

describe('report', () => {
	const baseParams = {
		filePath: './test.nitpicker',
		sheetUrl: 'https://docs.google.com/spreadsheets/d/xxx/edit',
		credentialFilePath: './credentials.json',
		configPath: null,
		limit: 100_000,
	};

	beforeEach(() => {
		vi.clearAllMocks();
		capturedOnLog.current = null;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('skips enquirer prompt when all=true', async () => {
		const promptSpy = vi.spyOn(enquirer, 'prompt');

		await report({ ...baseParams, all: true });

		expect(promptSpy).not.toHaveBeenCalled();
	});

	it('calls enquirer prompt when all is not set', async () => {
		const promptSpy = vi.spyOn(enquirer, 'prompt').mockResolvedValue({
			sheetName: ['Page List'],
		});

		await report({ ...baseParams, all: false });

		expect(promptSpy).toHaveBeenCalledTimes(1);
	});

	it('does not create Lanes when silent=true', async () => {
		const lanesSpy = vi.spyOn(Lanes.prototype, 'close');

		await report({ ...baseParams, all: true, silent: true });

		expect(lanesSpy).not.toHaveBeenCalled();
	});

	it('creates Lanes when silent is not set', async () => {
		const lanesSpy = vi.spyOn(Lanes.prototype, 'close');

		await report({ ...baseParams, all: true, silent: false });

		expect(lanesSpy).toHaveBeenCalled();
	});

	it('正常完了時に removeSignalHandlers と archive.close を呼び出す', async () => {
		await report({ ...baseParams, all: true });

		expect(mockRemoveSignalHandlers).toHaveBeenCalledTimes(1);
		expect(mockArchiveClose).toHaveBeenCalledTimes(1);
	});

	it('createSheets が例外をスローしても removeSignalHandlers と archive.close を呼び出す', async () => {
		const { createSheets } = await import('./sheets/create-sheets.js');
		vi.mocked(createSheets).mockRejectedValueOnce(new Error('sheets error'));

		await expect(report({ ...baseParams, all: true })).rejects.toThrow('sheets error');

		expect(mockRemoveSignalHandlers).toHaveBeenCalledTimes(1);
		expect(mockArchiveClose).toHaveBeenCalledTimes(1);
	});

	it('passes all 9 sheets to createSheets when all=true', async () => {
		const { createSheets } = await import('./sheets/create-sheets.js');

		await report({ ...baseParams, all: true });

		expect(createSheets).toHaveBeenCalledWith(
			expect.objectContaining({
				createSheetList: expect.arrayContaining([
					expect.any(Function),
					expect.any(Function),
					expect.any(Function),
					expect.any(Function),
					expect.any(Function),
					expect.any(Function),
					expect.any(Function),
					expect.any(Function),
				]),
			}),
		);
		const call = vi.mocked(createSheets).mock.calls[0]?.[0];
		// 8 sheets (Summary is handled separately via addToSummary)
		expect(call?.createSheetList).toHaveLength(8);
	});
});

describe('report onLog label', () => {
	const baseParams = {
		filePath: './test.nitpicker',
		sheetUrl: 'https://docs.google.com/spreadsheets/d/xxx/edit',
		credentialFilePath: './credentials.json',
		configPath: null,
		limit: 100_000,
	};

	beforeEach(() => {
		vi.clearAllMocks();
		capturedOnLog.current = null;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('onLog に ServerError メッセージを渡すと "Server Error (502)" ラベルで lanes.update が呼ばれる', async () => {
		const updateSpy = vi.spyOn(Lanes.prototype, 'update');

		await report({ ...baseParams, all: true, silent: false });

		expect(capturedOnLog.current).toBeTypeOf('function');

		capturedOnLog.current!.call(undefined, {
			message: 'ServerError',
			waitTime: 30_000,
			waiting: true,
			code: 502,
		} satisfies ErrorHandlerMessage);

		expect(updateSpy).toHaveBeenCalledWith(
			10_000,
			expect.stringContaining('Server Error (502)'),
		);
	});

	it('onLog に TooManyRequestError メッセージを渡すと "Too Many Requests (429)" ラベルで lanes.update が呼ばれる', async () => {
		const updateSpy = vi.spyOn(Lanes.prototype, 'update');

		await report({ ...baseParams, all: true, silent: false });

		capturedOnLog.current!.call(undefined, {
			message: 'TooManyRequestError',
			waitTime: 110_000,
			waiting: true,
			code: '429',
		} satisfies ErrorHandlerMessage);

		expect(updateSpy).toHaveBeenCalledWith(
			10_000,
			expect.stringContaining('Too Many Requests (429)'),
		);
	});

	it('onLog に UserRateLimitExceededError メッセージを渡すと "Rate Limit Exceeded (403)" ラベルで lanes.update が呼ばれる', async () => {
		const updateSpy = vi.spyOn(Lanes.prototype, 'update');

		await report({ ...baseParams, all: true, silent: false });

		capturedOnLog.current!.call(undefined, {
			message: 'UserRateLimitExceededError',
			waitTime: 60_000,
			waiting: true,
			code: '403',
		} satisfies ErrorHandlerMessage);

		expect(updateSpy).toHaveBeenCalledWith(
			10_000,
			expect.stringContaining('Rate Limit Exceeded (403)'),
		);
	});

	it('onLog に ECONNRESET メッセージを渡すと "Connection Reset" ラベルで lanes.update が呼ばれる', async () => {
		const updateSpy = vi.spyOn(Lanes.prototype, 'update');

		await report({ ...baseParams, all: true, silent: false });

		capturedOnLog.current!.call(undefined, {
			message: 'ECONNRESET',
			waitTime: 5000,
			waiting: true,
			code: 'ECONNRESET',
		} satisfies ErrorHandlerMessage);

		expect(updateSpy).toHaveBeenCalledWith(
			10_000,
			expect.stringContaining('Connection Reset'),
		);
	});

	it('onLog に waiting: false を渡すと lanes.delete が呼ばれる', async () => {
		const deleteSpy = vi.spyOn(Lanes.prototype, 'delete');

		await report({ ...baseParams, all: true, silent: false });

		// まず waiting: true を送ってカウントを増やす
		capturedOnLog.current!.call(undefined, {
			message: 'ServerError',
			waitTime: 30_000,
			waiting: true,
			code: 502,
		} satisfies ErrorHandlerMessage);

		// waiting: false で解除
		capturedOnLog.current!.call(undefined, {
			message: 'ServerError',
			waitTime: 30_000,
			waiting: false,
			code: 502,
		} satisfies ErrorHandlerMessage);

		expect(deleteSpy).toHaveBeenCalledWith(10_000);
	});

	it('ServerError で code が未指定のとき "Server Error (5xx)" ラベルになる', async () => {
		const updateSpy = vi.spyOn(Lanes.prototype, 'update');

		await report({ ...baseParams, all: true, silent: false });

		capturedOnLog.current!.call(undefined, {
			message: 'ServerError',
			waitTime: 30_000,
			waiting: true,
		} satisfies ErrorHandlerMessage);

		expect(updateSpy).toHaveBeenCalledWith(
			10_000,
			expect.stringContaining('Server Error (5xx)'),
		);
	});
});
