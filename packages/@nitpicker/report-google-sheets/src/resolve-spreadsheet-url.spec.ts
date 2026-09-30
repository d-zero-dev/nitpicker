import { beforeEach, describe, it, expect, vi } from 'vitest';

import { resolveSpreadsheetUrl } from './resolve-spreadsheet-url.js';

const { mockCreateSpreadsheet } = vi.hoisted(() => ({
	mockCreateSpreadsheet: vi.fn(),
}));

vi.mock('@d-zero/google-sheets', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@d-zero/google-sheets')>();
	return {
		parseGoogleUrl: actual.parseGoogleUrl,
		createSpreadsheet: mockCreateSpreadsheet,
	};
});

const auth = {} as never;
const folderUrl = 'https://drive.google.com/drive/folders/folder123';
const spreadsheetUrl = 'https://docs.google.com/spreadsheets/d/xyz789/edit';

describe('resolveSpreadsheetUrl', () => {
	beforeEach(() => {
		mockCreateSpreadsheet.mockReset();
	});

	it('returns a Spreadsheet URL unchanged without calling the Drive API', async () => {
		const url = await resolveSpreadsheetUrl({
			sheetUrl: spreadsheetUrl,
			archiveFilePath: './a.nitpicker',
			auth,
		});

		expect(url).toBe(spreadsheetUrl);
		expect(mockCreateSpreadsheet).not.toHaveBeenCalled();
	});

	it('returns an unrecognized URL unchanged so the existing error path handles it', async () => {
		const url = await resolveSpreadsheetUrl({
			sheetUrl: 'not a url',
			archiveFilePath: './a.nitpicker',
			auth,
		});

		expect(url).toBe('not a url');
		expect(mockCreateSpreadsheet).not.toHaveBeenCalled();
	});

	it.each([
		['./example.com.nitpicker', 'example.com'],
		['/abs/dir/site.nitpicker', 'site'],
		['./no-extension', 'no-extension'],
		['./report.v2.nitpicker', 'report.v2'],
	])('titles the created Spreadsheet from %s as "%s"', async (archiveFilePath, title) => {
		mockCreateSpreadsheet.mockResolvedValue({ id: 'new', url: 'https://created' });

		const url = await resolveSpreadsheetUrl({
			sheetUrl: folderUrl,
			archiveFilePath,
			auth,
		});

		expect(url).toBe('https://created');
		expect(mockCreateSpreadsheet).toHaveBeenCalledWith(folderUrl, title, auth);
	});

	it('wraps a non-Error rejection reason into the message', async () => {
		mockCreateSpreadsheet.mockRejectedValue('quota exceeded');

		await expect(
			resolveSpreadsheetUrl({
				sheetUrl: folderUrl,
				archiveFilePath: './a.nitpicker',
				auth,
			}),
		).rejects.toThrow(/quota exceeded/);
	});

	it('rethrows a creation failure with a token.json re-authorization hint and the original cause', async () => {
		const original = new Error('Insufficient Permission');
		mockCreateSpreadsheet.mockRejectedValue(original);

		const promise = resolveSpreadsheetUrl({
			sheetUrl: folderUrl,
			archiveFilePath: './a.nitpicker',
			auth,
		});

		await expect(promise).rejects.toThrow(/Insufficient Permission[\s\S]*token\.json/);
		await expect(promise).rejects.toHaveProperty('cause', original);
	});
});
