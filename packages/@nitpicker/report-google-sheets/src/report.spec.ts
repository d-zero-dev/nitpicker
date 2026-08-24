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

const { mockAsyncDispose } = vi.hoisted(() => ({
	mockAsyncDispose: vi.fn(),
}));

vi.mock('./open-report-archive.js', () => ({
	openReportArchive: vi.fn().mockResolvedValue({
		accessor: {},
		removeSignalHandlers: vi.fn(),
		async [Symbol.asyncDispose]() {
			await mockAsyncDispose();
		},
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

describe('report', () => {
	const baseParams = {
		filePath: './test.nitpicker',
		sheetUrl: 'https://docs.google.com/spreadsheets/d/xxx/edit',
		credentialFilePath: './credentials.json',
		configPath: null,
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

	it('forwards onExtractProgress to openReportArchive (issue #294)', async () => {
		vi.spyOn(enquirer, 'prompt').mockResolvedValue({ sheetName: ['Page List'] });
		const { openReportArchive } = await import('./open-report-archive.js');
		const onExtractProgress = vi.fn();

		await report({ ...baseParams, all: true, onExtractProgress });

		expect(openReportArchive).toHaveBeenCalledWith(
			baseParams.filePath,
			onExtractProgress,
		);
	});

	it('does not create Lanes when silent=true', async () => {
		const lanesSpy = vi.spyOn(Lanes.prototype, Symbol.dispose);

		await report({ ...baseParams, all: true, silent: true });

		expect(lanesSpy).not.toHaveBeenCalled();
	});

	it('creates Lanes when silent is not set', async () => {
		const lanesSpy = vi.spyOn(Lanes.prototype, Symbol.dispose);

		await report({ ...baseParams, all: true, silent: false });

		expect(lanesSpy).toHaveBeenCalled();
	});

	it('disposes the archive handle (removeSignalHandlers + manager close) on normal completion', async () => {
		await report({ ...baseParams, all: true });

		expect(mockAsyncDispose).toHaveBeenCalledTimes(1);
	});

	it('disposes the archive handle even when createSheets throws', async () => {
		const { createSheets } = await import('./sheets/create-sheets.js');
		vi.mocked(createSheets).mockRejectedValueOnce(new Error('sheets error'));

		await expect(report({ ...baseParams, all: true })).rejects.toThrow('sheets error');

		expect(mockAsyncDispose).toHaveBeenCalledTimes(1);
	});

	it('passes 8 sheets to createSheets when all=true (Summary is a no-op)', async () => {
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
		expect(call?.createSheetList).toHaveLength(8);
	});

	it('warns and generates no sheet when "Summary" is selected (not yet implemented)', async () => {
		vi.spyOn(enquirer, 'prompt').mockResolvedValue({ sheetName: ['Summary'] });
		const { createSheets } = await import('./sheets/create-sheets.js');
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		await report({ ...baseParams, all: false });

		const call = vi.mocked(createSheets).mock.calls[0]?.[0];
		expect(call?.createSheetList).toHaveLength(0);
		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Summary'));
	});

	it('builds createSheetList in fixed SHEET_PRIORITY_ORDER regardless of selection order', async () => {
		vi.spyOn(enquirer, 'prompt').mockResolvedValue({
			sheetName: ['Resources', 'Page List', 'Links'],
		});
		const { createSheets } = await import('./sheets/create-sheets.js');

		await report({ ...baseParams, all: false });

		const call = vi.mocked(createSheets).mock.calls[0]?.[0];
		expect(call?.createSheetList).toHaveLength(3);
	});
});

describe('report onLog label', () => {
	const baseParams = {
		filePath: './test.nitpicker',
		sheetUrl: 'https://docs.google.com/spreadsheets/d/xxx/edit',
		credentialFilePath: './credentials.json',
		configPath: null,
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
