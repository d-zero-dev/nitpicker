import type { CreateSheet } from '../../sheets/types.js';
import type { Auth } from '@d-zero/google-auth';
import type { Report } from '@nitpicker/types';

import { Sheets } from '@d-zero/google-sheets';
import { google } from 'googleapis';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';

import { createLinks } from '../../data/create-links.js';
import { createPageList } from '../../data/create-page-list.js';
import { createResources } from '../../data/create-resources.js';
import { createViolations } from '../../data/create-violations.js';
import { createSheets } from '../../sheets/create-sheets.js';

import {
	type CrawlResult,
	SPREADSHEET_ID,
	SPREADSHEET_URL,
	cleanupCrawl,
	crawlTestServer,
	deleteSheet,
	getAuth,
	readSheetValues,
	testSheetName,
} from './helpers.js';

// This `ProvidedContext` shape is duplicated in
// `packages/test-server/src/__tests__/e2e/test-server-port.ts` (a separate TS
// project — this package has no reference to that one) — keep both
// declarations in sync if `testServerPort`'s shape ever changes.
declare module 'vitest' {
	interface ProvidedContext {
		testServerPort: number;
	}
}

describe('createSheets pipeline', () => {
	let auth: Auth;
	let crawlResult: CrawlResult;
	const createdSheetIds: number[] = [];
	const emptyReports: Report[] = [];

	beforeAll(async () => {
		auth = await getAuth();
		const port = inject('testServerPort');
		crawlResult = await crawlTestServer([`http://localhost:${port}/`], {
			recursive: true,
			fetchExternal: false,
		});
	});

	afterEach(async () => {
		for (const sheetId of createdSheetIds) {
			try {
				await deleteSheet(auth, SPREADSHEET_ID, sheetId);
			} catch {
				// already deleted or not found
			}
		}
		createdSheetIds.length = 0;
	});

	afterAll(async () => {
		if (crawlResult) {
			await cleanupCrawl(crawlResult);
		}
	});

	it('Violations シートを正しく生成できる', async () => {
		const sheetName = testSheetName('violations');
		const sheets = new Sheets(SPREADSHEET_URL, auth);

		const createTestViolations: CreateSheet = (reports, accessor) => {
			const setting = createViolations(reports, accessor);
			return { ...setting, name: sheetName };
		};

		await createSheets({
			sheets,
			accessor: crawlResult.archive,
			reports: emptyReports,
			createSheetList: [createTestViolations],
		});

		const sheet = await sheets.create(sheetName);
		createdSheetIds.push(sheet.id);

		// Verify headers
		const values = await readSheetValues(auth, SPREADSHEET_ID, `'${sheetName}'!A1:F1`);
		expect(values[0]).toEqual([
			'Validator',
			'Severity',
			'Rule',
			'Code',
			'Message',
			'URL',
		]);

		// No data rows since reports are empty
		const allValues = await readSheetValues(
			auth,
			SPREADSHEET_ID,
			`'${sheetName}'!A1:F100`,
		);
		expect(allValues.length).toBe(1); // header only
	});

	it('Page List シートを正しく生成できる', async () => {
		const sheetName = testSheetName('pagelist');
		const sheets = new Sheets(SPREADSHEET_URL, auth);

		const createTestPageList: CreateSheet = (reports, accessor) => {
			const setting = createPageList(reports, accessor);
			return { ...setting, name: sheetName };
		};

		await createSheets({
			sheets,
			accessor: crawlResult.archive,
			reports: emptyReports,
			createSheetList: [createTestPageList],
		});

		const sheet = await sheets.create(sheetName);
		createdSheetIds.push(sheet.id);

		// Verify headers contain expected columns
		const headerValues = await readSheetValues(
			auth,
			SPREADSHEET_ID,
			`'${sheetName}'!A1:AK1`,
		);
		const headers = headerValues[0]!;
		expect(headers).toContain('Title');
		expect(headers).toContain('URL');
		expect(headers).toContain('Status Code');
		expect(headers).toContain('Internal Links');
		expect(headers).toContain('External Links');

		// Verify data rows exist (at least 1 page from test server)
		const allValues = await readSheetValues(
			auth,
			SPREADSHEET_ID,
			`'${sheetName}'!A1:A100`,
		);
		expect(allValues.length).toBeGreaterThan(1); // header + at least 1 data row

		// Verify frozen panes and conditional format were applied
		const sheetsApi = google.sheets({ version: 'v4', auth: auth as unknown });
		const res = await sheetsApi.spreadsheets.get({
			spreadsheetId: SPREADSHEET_ID,
			includeGridData: false,
			fields: 'sheets(properties,conditionalFormats)',
		});
		const targetSheet = res.data.sheets?.find((s) => s.properties?.sheetId === sheet.id);

		expect(targetSheet?.properties?.gridProperties?.frozenColumnCount).toBe(1);
		expect(targetSheet?.properties?.gridProperties?.frozenRowCount).toBe(1);
		expect(targetSheet?.conditionalFormats).toBeDefined();
		expect(targetSheet!.conditionalFormats!.length).toBeGreaterThanOrEqual(1);
	});

	it('Links シートを正しく生成できる', async () => {
		const sheetName = testSheetName('links');
		const sheets = new Sheets(SPREADSHEET_URL, auth);

		const createTestLinks: CreateSheet = (reports, accessor) => {
			const setting = createLinks(reports, accessor);
			return { ...setting, name: sheetName };
		};

		await createSheets({
			sheets,
			accessor: crawlResult.archive,
			reports: emptyReports,
			createSheetList: [createTestLinks],
		});

		const sheet = await sheets.create(sheetName);
		createdSheetIds.push(sheet.id);

		// Verify headers
		const headerValues = await readSheetValues(
			auth,
			SPREADSHEET_ID,
			`'${sheetName}'!A1:I1`,
		);
		expect(headerValues[0]).toEqual([
			'URL',
			'Page Title',
			'Status Code',
			'Status Text',
			'Content Type',
			'Redirect From',
			'Referrers',
			'Headers',
			'Remarks',
		]);

		// Verify data rows exist (links from test server pages)
		const allValues = await readSheetValues(
			auth,
			SPREADSHEET_ID,
			`'${sheetName}'!A1:A100`,
		);
		expect(allValues.length).toBeGreaterThan(1);
	});

	it('Resources シートを正しく生成できる', async () => {
		const sheetName = testSheetName('resources');
		const sheets = new Sheets(SPREADSHEET_URL, auth);

		const createTestResources: CreateSheet = (reports, accessor) => {
			const setting = createResources()(reports, accessor);
			return { ...setting, name: sheetName };
		};

		await createSheets({
			sheets,
			accessor: crawlResult.archive,
			reports: emptyReports,
			createSheetList: [createTestResources],
		});

		const sheet = await sheets.create(sheetName);
		createdSheetIds.push(sheet.id);

		// Verify headers
		const headerValues = await readSheetValues(
			auth,
			SPREADSHEET_ID,
			`'${sheetName}'!A1:F1`,
		);
		expect(headerValues[0]).toEqual([
			'URL',
			'Status Code',
			'Status Text',
			'Content Type',
			'Content Length',
			'Referrers',
		]);
	});

	it('Resources シート (dedupe mode) に Count 列を含むヘッダーが出力される', async () => {
		const sheetName = testSheetName('resources-dedupe');
		const sheets = new Sheets(SPREADSHEET_URL, auth);

		const createTestResources: CreateSheet = (reports, accessor) => {
			const setting = createResources({ dedupe: true })(reports, accessor);
			return { ...setting, name: sheetName };
		};

		await createSheets({
			sheets,
			accessor: crawlResult.archive,
			reports: emptyReports,
			createSheetList: [createTestResources],
		});

		const sheet = await sheets.create(sheetName);
		createdSheetIds.push(sheet.id);

		const headerValues = await readSheetValues(
			auth,
			SPREADSHEET_ID,
			`'${sheetName}'!A1:H1`,
		);
		expect(headerValues[0]).toEqual([
			'URL',
			'Status Code',
			'Status Text',
			'Content Type',
			'Content Length',
			'Referrers',
			'Count',
			'Query Pattern',
		]);

		// Body must have at least 1 data row (the e2e test server publishes
		// several sub-resources). All URLs should appear canonicalized — they
		// must not contain any '=' since query values are stripped.
		const body = await readSheetValues(auth, SPREADSHEET_ID, `'${sheetName}'!A2:H500`);
		expect(body.length).toBeGreaterThan(0);
		for (const row of body) {
			const url = String(row[0] ?? '');
			expect(url).not.toMatch(/\?[^&=]*=/);
		}
	});
});
