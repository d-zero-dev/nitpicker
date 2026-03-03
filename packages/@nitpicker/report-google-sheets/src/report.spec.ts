import { Lanes } from '@d-zero/dealer';
import enquirer from 'enquirer';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { report } from './report.js';

vi.mock('@d-zero/google-auth', () => ({
	authentication: vi.fn().mockResolvedValue({}),
}));

vi.mock('@d-zero/google-sheets', () => ({
	Sheets: class {
		onLog = null;
	},
}));

vi.mock('./archive.js', () => ({
	getArchive: vi.fn().mockResolvedValue({
		close: vi.fn(),
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
