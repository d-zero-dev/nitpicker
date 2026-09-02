import enquirer from 'enquirer';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { report } from './report.js';

vi.mock('@d-zero/google-auth', () => ({
	authentication: vi.fn().mockResolvedValue({}),
}));

const resolveAndValidatePageListUrlFilter = vi.fn();
const warnUnmatchedPageListUrls = vi.fn();

vi.mock('@nitpicker/query', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@nitpicker/query')>();
	return {
		...actual,
		resolveAndValidatePageListUrlFilter: (...args: unknown[]) =>
			resolveAndValidatePageListUrlFilter(...args),
		warnUnmatchedPageListUrls: (...args: unknown[]) => warnUnmatchedPageListUrls(...args),
	};
});

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
		resolveAndValidatePageListUrlFilter.mockReset();
		warnUnmatchedPageListUrls.mockReset();
		warnUnmatchedPageListUrls.mockResolvedValue();
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

	describe('--urls', () => {
		it('restricts --all to the 4 URL-filterable sheets (Page List/Links/Violations/Images)', async () => {
			resolveAndValidatePageListUrlFilter.mockResolvedValue(['https://example.com/a']);
			const { createSheets } = await import('./sheets/create-sheets.js');

			await report({ ...baseParams, all: true, urls: ['https://example.com/a'] });

			const call = vi.mocked(createSheets).mock.calls[0]?.[0];
			expect(call?.createSheetList).toHaveLength(4);
		});

		it('restricts the interactive picker choices to the 4 URL-filterable sheets', async () => {
			resolveAndValidatePageListUrlFilter.mockResolvedValue(['https://example.com/a']);
			const promptSpy = vi
				.spyOn(enquirer, 'prompt')
				.mockResolvedValue({ sheetName: ['Page List'] });

			await report({ ...baseParams, all: false, urls: ['https://example.com/a'] });

			expect(promptSpy).toHaveBeenCalledWith([
				expect.objectContaining({
					choices: ['Page List', 'Links', 'Violations', 'Images'],
				}),
			]);
		});

		it('propagates the rejection when --urls matches no valid HTTP(S) URL after normalization', async () => {
			resolveAndValidatePageListUrlFilter.mockRejectedValue(
				new Error(
					'--urls matched no valid HTTP(S) URL after normalization; nothing to report.',
				),
			);

			await expect(
				report({ ...baseParams, all: true, urls: ['not a url'] }),
			).rejects.toThrow(/--urls matched no valid HTTP\(S\) URL/);
		});

		it('warns about excluded sheets and forwards a working onWarn to warnUnmatchedPageListUrls', async () => {
			resolveAndValidatePageListUrlFilter.mockResolvedValue(['https://example.com/a']);
			warnUnmatchedPageListUrls.mockImplementation(
				(_accessor: unknown, _urls: unknown, onWarn: (message: string) => void) => {
					onWarn('1 of 2 URL(s) were not found in the report');
					return Promise.resolve();
				},
			);
			const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			await report({ ...baseParams, all: true, urls: ['https://example.com/a'] });

			expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Excluded'));
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining('1 of 2 URL(s) were not found in the report'),
			);
			expect(warnUnmatchedPageListUrls).toHaveBeenCalledWith(
				expect.anything(),
				['https://example.com/a'],
				expect.any(Function),
			);
		});

		it('does not restrict sheet selection when --urls is not given', async () => {
			const { createSheets } = await import('./sheets/create-sheets.js');

			await report({ ...baseParams, all: true });

			expect(resolveAndValidatePageListUrlFilter).not.toHaveBeenCalled();
			expect(warnUnmatchedPageListUrls).not.toHaveBeenCalled();
			const call = vi.mocked(createSheets).mock.calls[0]?.[0];
			expect(call?.createSheetList).toHaveLength(8);
		});
	});
});
