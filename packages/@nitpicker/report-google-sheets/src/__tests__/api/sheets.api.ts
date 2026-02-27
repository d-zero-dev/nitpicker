import type { Auth } from '@d-zero/google-auth';

import { Sheets } from '@d-zero/google-sheets';
import { google } from 'googleapis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCellData } from '../../sheets/create-cell-data.js';
import { defaultCellFormat } from '../../sheets/default-cell-format.js';

import {
	SPREADSHEET_ID,
	SPREADSHEET_URL,
	deleteSheet,
	getAuth,
	getSheetProperties,
	readSheetValues,
	testSheetName,
} from './helpers.js';

describe('Sheets class', () => {
	let auth: Auth;
	let sheets: Sheets;
	const createdSheetIds: number[] = [];

	beforeAll(async () => {
		auth = await getAuth();
		sheets = new Sheets(SPREADSHEET_URL, auth);
	});

	afterAll(async () => {
		for (const sheetId of createdSheetIds) {
			try {
				await deleteSheet(auth, SPREADSHEET_ID, sheetId);
			} catch {
				// already deleted or not found
			}
		}
	});

	it('create() で新規シートを作成できる', async () => {
		const name = testSheetName('new');
		const sheet = await sheets.create(name);
		createdSheetIds.push(sheet.id);

		expect(sheet.id).toBeTypeOf('number');
		expect(sheet.props.title).toBe(name);
	});

	it('create() で既存シートを返す（キャッシュ）', async () => {
		const name = testSheetName('cache');
		const sheet1 = await sheets.create(name);
		createdSheetIds.push(sheet1.id);

		const sheet2 = await sheets.create(name);

		expect(sheet2.id).toBe(sheet1.id);
	});
});

describe('Sheet class — addRowData', () => {
	let auth: Auth;
	let sheets: Sheets;
	let sheetName: string;
	let sheetId: number;

	beforeAll(async () => {
		auth = await getAuth();
		sheets = new Sheets(SPREADSHEET_URL, auth);

		// Use a single sheet for all addRowData tests
		sheetName = testSheetName('rowdata');
		const sheet = await sheets.create(sheetName);
		sheetId = sheet.id;

		// Write header
		const headers = ['String', 'Number', 'Boolean', 'Null', 'Formula', 'Link'];
		const headerRow = headers.map((h) =>
			createCellData({ value: h, textFormat: { bold: true } }, defaultCellFormat),
		);
		await sheet.addRowData([headerRow], false);

		// Write data row
		const dataRow = [
			createCellData({ value: 'hello world' }, defaultCellFormat),
			createCellData({ value: 42 }, defaultCellFormat),
			createCellData({ value: true }, defaultCellFormat),
			createCellData({ value: null }, defaultCellFormat),
			createCellData({ value: '=1+2' }, defaultCellFormat),
			createCellData(
				{
					value: 'https://example.com',
					textFormat: { link: { uri: 'https://example.com' } },
				},
				defaultCellFormat,
			),
		];
		await sheet.addRowData([dataRow], true);
	});

	afterAll(async () => {
		try {
			await deleteSheet(auth, SPREADSHEET_ID, sheetId);
		} catch {
			// ignore
		}
	});

	it('ヘッダー行が正しく書き込まれている', async () => {
		const values = await readSheetValues(auth, SPREADSHEET_ID, `'${sheetName}'!A1:F1`);
		expect(values[0]).toEqual(['String', 'Number', 'Boolean', 'Null', 'Formula', 'Link']);
	});

	it('データ行の各セル型が正しく書き込まれている', async () => {
		const values = await readSheetValues(auth, SPREADSHEET_ID, `'${sheetName}'!A2:F2`);
		const row = values[0]!;
		expect(row[0]).toBe('hello world');
		expect(row[1]).toBe('42');
		expect(row[2]).toBe('TRUE');
		expect(row[3]).toBe(''); // null renders as empty string
		expect(row[4]).toBe('3'); // =1+2 evaluated
		expect(row[5]).toBe('https://example.com'); // HYPERLINK shows decoded URL
	});
});

describe('Sheet class — formatting', () => {
	let auth: Auth;
	let sheets: Sheets;
	let sheetName: string;
	let sheetId: number;

	beforeAll(async () => {
		auth = await getAuth();
		sheets = new Sheets(SPREADSHEET_URL, auth);

		// Use a single sheet for all formatting tests
		sheetName = testSheetName('format');
		const sheet = await sheets.create(sheetName);
		sheetId = sheet.id;

		// Write enough data to enable frozen/hideCol
		const headerRow = [
			createCellData({ value: 'Col1' }, defaultCellFormat),
			createCellData({ value: 'Col2' }, defaultCellFormat),
			createCellData({ value: 'Col3' }, defaultCellFormat),
		];
		const dataRows = Array.from({ length: 3 }, () => [
			createCellData({ value: 'A' }, defaultCellFormat),
			createCellData({ value: 'B' }, defaultCellFormat),
			createCellData({ value: 'C' }, defaultCellFormat),
		]);
		await sheet.addRowData([headerRow], false);
		await sheet.addRowData(dataRows, true);

		// Apply all formatting at once
		await sheet.frozen(1, 1);
		await sheet.hideCol(2);
		await sheet.conditionalFormat([0], {
			booleanRule: {
				condition: {
					type: 'NUMBER_GREATER_THAN_EQ',
					values: [{ userEnteredValue: '400' }],
				},
				format: {
					backgroundColor: { red: 0.9 },
					textFormat: {
						foregroundColor: { red: 1, green: 1, blue: 1 },
					},
				},
			},
		});
	});

	afterAll(async () => {
		try {
			await deleteSheet(auth, SPREADSHEET_ID, sheetId);
		} catch {
			// ignore
		}
	});

	it('frozen() で行列が固定されている', async () => {
		const sheetData = await getSheetProperties(auth, SPREADSHEET_ID, sheetId);
		expect(sheetData?.properties?.gridProperties?.frozenColumnCount).toBe(1);
		expect(sheetData?.properties?.gridProperties?.frozenRowCount).toBe(1);
	});

	it('hideCol() で列が非表示になっている', async () => {
		const sheetsApi = google.sheets({ version: 'v4', auth: auth as unknown });
		const res = await sheetsApi.spreadsheets.get({
			spreadsheetId: SPREADSHEET_ID,
			includeGridData: false,
			fields: 'sheets(properties,data.columnMetadata)',
			ranges: [`'${sheetName}'`],
		});
		const targetSheet = res.data.sheets?.[0];
		const colMetadata = targetSheet?.data?.[0]?.columnMetadata;
		expect(colMetadata?.[2]?.hiddenByUser).toBe(true);
	});

	it('conditionalFormat() で条件付き書式が設定されている', async () => {
		const sheetsApi = google.sheets({ version: 'v4', auth: auth as unknown });
		const res = await sheetsApi.spreadsheets.get({
			spreadsheetId: SPREADSHEET_ID,
			includeGridData: false,
			fields: 'sheets(properties,conditionalFormats)',
		});
		const targetSheet = res.data.sheets?.find((s) => s.properties?.sheetId === sheetId);
		const formats = targetSheet?.conditionalFormats;
		expect(formats).toBeDefined();
		expect(formats!.length).toBeGreaterThanOrEqual(1);

		const rule = formats![0]!;
		expect(rule.booleanRule?.condition?.type).toBe('NUMBER_GREATER_THAN_EQ');
		expect(rule.ranges?.[0]?.startColumnIndex).toBe(0);
		expect(rule.ranges?.[0]?.endColumnIndex).toBe(1);
	});
});
