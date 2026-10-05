import type { CreateSheet } from './sheets/types.js';

import enquirer from 'enquirer';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { report } from './report.js';

/**
 * Resolves each `CreateSheet` factory result's `name` field, in array
 * order — lets `--sheets` tests assert exactly which sheets were selected
 * and in what order, instead of only the array length (which can't catch a
 * wrong sheet or a broken `SHEET_PRIORITY_ORDER` sort). Each factory's
 * top-level object construction is synchronous and side-effect-free (real
 * archive reads happen inside `createHeaders`/`estimateRowCount`/etc.,
 * never called here), so a bare `{}` accessor stand-in is safe.
 * @param createSheetList - The `createSheetList` array `report()` passed to `createSheets`.
 * @returns The resolved sheets' `name` values, in the same order.
 */
async function sheetNamesOf(createSheetList: readonly CreateSheet[]): Promise<string[]> {
	const settings = await Promise.all(
		createSheetList.map((createSheet) => createSheet([], {} as never)),
	);
	return settings.map((setting) => setting.name);
}

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
const { mockCreateSpreadsheet } = vi.hoisted(() => ({
	mockCreateSpreadsheet: vi.fn(),
}));

// `parseGoogleUrl` stays real so the folder-vs-Spreadsheet branching under test
// is the library's own; only the Drive API call (`createSpreadsheet`) is stubbed.
vi.mock('@d-zero/google-sheets', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@d-zero/google-sheets')>();
	return {
		parseGoogleUrl: actual.parseGoogleUrl,
		createSpreadsheet: mockCreateSpreadsheet,
		Sheets: class {
			constructor(readonly url: string) {}
		},
	};
});

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

	it('passes the given credentialFilePath to authentication as is', async () => {
		const { authentication } = await import('@d-zero/google-auth');

		await report({ ...baseParams, credentialFilePath: './sa.json', all: true });

		expect(vi.mocked(authentication).mock.calls[0]?.[0]).toBe('./sa.json');
	});

	it('passes an omitted credentialFilePath to authentication as undefined so google-auth falls back to the environment and ADC', async () => {
		const { authentication } = await import('@d-zero/google-auth');

		await report({
			filePath: baseParams.filePath,
			sheetUrl: baseParams.sheetUrl,
			configPath: null,
			all: true,
		});

		expect(vi.mocked(authentication)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(authentication).mock.calls[0]?.[0]).toBeUndefined();
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

	describe('sheets', () => {
		it('takes precedence over all=true: only the named sheets are generated', async () => {
			const { createSheets } = await import('./sheets/create-sheets.js');

			await report({
				...baseParams,
				all: true,
				sheets: ['Page List', 'Links'],
			});

			const call = vi.mocked(createSheets).mock.calls[0]?.[0];
			await expect(sheetNamesOf(call?.createSheetList ?? [])).resolves.toStrictEqual([
				'Page List',
				'Links',
			]);
		});

		it('takes precedence over all=false and skips the interactive prompt entirely', async () => {
			const promptSpy = vi.spyOn(enquirer, 'prompt');
			const { createSheets } = await import('./sheets/create-sheets.js');

			await report({
				...baseParams,
				all: false,
				sheets: ['Page List'],
			});

			expect(promptSpy).not.toHaveBeenCalled();
			const call = vi.mocked(createSheets).mock.calls[0]?.[0];
			await expect(sheetNamesOf(call?.createSheetList ?? [])).resolves.toStrictEqual([
				'Page List',
			]);
		});

		it('generates Resources/Referrers Relational Table even when --urls is also given', async () => {
			resolveAndValidatePageListUrlFilter.mockResolvedValue(['https://example.com/a']);
			const { createSheets } = await import('./sheets/create-sheets.js');

			await report({
				...baseParams,
				all: true,
				urls: ['https://example.com/a'],
				sheets: ['Page List', 'Resources', 'Referrers Relational Table'],
			});

			const call = vi.mocked(createSheets).mock.calls[0]?.[0];
			await expect(sheetNamesOf(call?.createSheetList ?? [])).resolves.toStrictEqual([
				'Page List',
				'Resources',
				'Referrers Relational Table',
			]);
		});

		it('builds createSheetList in fixed SHEET_PRIORITY_ORDER regardless of the sheets array order', async () => {
			const { createSheets } = await import('./sheets/create-sheets.js');

			await report({
				...baseParams,
				all: true,
				sheets: ['Resources', 'Page List', 'Links'],
			});

			const call = vi.mocked(createSheets).mock.calls[0]?.[0];
			// Input order was Resources, Page List, Links — SHEET_PRIORITY_ORDER
			// puts Page List and Links ahead of Resources regardless.
			await expect(sheetNamesOf(call?.createSheetList ?? [])).resolves.toStrictEqual([
				'Page List',
				'Links',
				'Resources',
			]);
		});
	});

	describe('Drive folder URL', () => {
		const folderParams = {
			...baseParams,
			filePath: './out/example.com.nitpicker',
			sheetUrl: 'https://drive.google.com/drive/folders/folder123',
			all: true,
		};

		beforeEach(() => {
			mockCreateSpreadsheet.mockReset();
			mockCreateSpreadsheet.mockResolvedValue({
				id: 'new-id',
				url: 'https://docs.google.com/spreadsheets/d/new-id/edit',
			});
		});

		it('requests the Drive scope only for a folder URL', async () => {
			const { authentication } = await import('@d-zero/google-auth');

			await report(folderParams);

			expect(vi.mocked(authentication).mock.calls[0]?.[1]).toStrictEqual([
				'https://www.googleapis.com/auth/spreadsheets',
				'https://www.googleapis.com/auth/drive.file',
			]);
		});

		it('keeps the Spreadsheets-only scope for a Spreadsheet URL', async () => {
			const { authentication } = await import('@d-zero/google-auth');

			await report({ ...baseParams, all: true });

			expect(vi.mocked(authentication).mock.calls[0]?.[1]).toStrictEqual([
				'https://www.googleapis.com/auth/spreadsheets',
			]);
			expect(mockCreateSpreadsheet).not.toHaveBeenCalled();
		});

		it('creates a Spreadsheet titled with the archive file name (no extension) and reports into it', async () => {
			const { createSheets } = await import('./sheets/create-sheets.js');

			await report(folderParams);

			expect(mockCreateSpreadsheet).toHaveBeenCalledWith(
				folderParams.sheetUrl,
				'example.com',
				expect.anything(),
			);
			const call = vi.mocked(createSheets).mock.calls[0]?.[0];
			expect(call?.sheets).toHaveProperty(
				'url',
				'https://docs.google.com/spreadsheets/d/new-id/edit',
			);
		});

		it('writes into the given Spreadsheet URL as is when it is not a folder URL', async () => {
			const { createSheets } = await import('./sheets/create-sheets.js');

			await report({ ...baseParams, all: true });

			const call = vi.mocked(createSheets).mock.calls[0]?.[0];
			expect(call?.sheets).toHaveProperty('url', baseParams.sheetUrl);
		});

		it('rejects without generating any sheet when the Spreadsheet cannot be created', async () => {
			const { createSheets } = await import('./sheets/create-sheets.js');
			mockCreateSpreadsheet.mockRejectedValue(new Error('403'));

			await expect(report(folderParams)).rejects.toThrow(
				/Failed to create a Spreadsheet/,
			);
			expect(createSheets).not.toHaveBeenCalled();
		});

		it('returns the created Spreadsheet URL even when silent', async () => {
			const url = await report({ ...folderParams, silent: true });

			expect(url).toBe('https://docs.google.com/spreadsheets/d/new-id/edit');
		});

		it('returns the given Spreadsheet URL unchanged for a Spreadsheet URL', async () => {
			const url = await report({ ...baseParams, all: true });

			expect(url).toBe(baseParams.sheetUrl);
		});

		it('does not create a Spreadsheet when the sheet prompt is cancelled', async () => {
			vi.spyOn(enquirer, 'prompt').mockResolvedValue(undefined as never);

			await report({ ...folderParams, all: false });

			expect(mockCreateSpreadsheet).not.toHaveBeenCalled();
		});
	});
});
