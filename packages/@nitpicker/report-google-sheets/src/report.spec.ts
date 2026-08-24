import enquirer from 'enquirer';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { report } from './report.js';

vi.mock('@d-zero/google-auth', () => ({
	authentication: vi.fn().mockResolvedValue({}),
}));

// `Sheets.onLog` (rate-limit backoff routing) is wired inside `createSheets`
// now, not here — mocked away below, so a plain stub class is enough.
vi.mock('@d-zero/google-sheets', () => ({
	Sheets: class {},
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

	it('forwards silent through to createSheets (TaskList display suppression)', async () => {
		const { createSheets } = await import('./sheets/create-sheets.js');

		await report({ ...baseParams, all: true, silent: true });

		const call = vi.mocked(createSheets).mock.calls[0]?.[0];
		expect(call?.options?.silent).toBe(true);
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
