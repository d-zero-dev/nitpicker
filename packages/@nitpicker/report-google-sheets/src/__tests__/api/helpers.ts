import type { Auth } from '@d-zero/google-auth';
import type { Archive } from '@nitpicker/crawler';
import type { sheets_v4 } from 'googleapis';

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { authentication } from '@d-zero/google-auth';
import { CrawlerOrchestrator } from '@nitpicker/crawler';
import { google } from 'googleapis';

const SPREADSHEET_ID = (() => {
	const id = process.env.TEST_SPREADSHEET_ID;
	if (!id) {
		throw new Error('TEST_SPREADSHEET_ID environment variable is required for API tests');
	}
	return id;
})();
const SPREADSHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`;
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'] as const;

export { SPREADSHEET_ID, SPREADSHEET_URL };

/**
 *
 */
export async function getAuth(): Promise<Auth> {
	const credentialFilePath = process.env.TEST_CREDENTIALS_PATH ?? 'credentials.json';
	const tokenFilePath = process.env.TEST_TOKEN_PATH ?? 'token.json';
	return authentication(credentialFilePath, SCOPES, { tokenFilePath });
}

/**
 *
 * @param auth
 * @param spreadsheetId
 * @param sheetId
 */
export async function deleteSheet(
	auth: Auth,
	spreadsheetId: string,
	sheetId: number,
): Promise<void> {
	const sheets = google.sheets({ version: 'v4', auth: auth as unknown });
	await sheets.spreadsheets.batchUpdate({
		spreadsheetId,
		requestBody: {
			requests: [{ deleteSheet: { sheetId } }],
		},
	});
}

/**
 *
 * @param auth
 * @param spreadsheetId
 * @param range
 */
export async function readSheetValues(
	auth: Auth,
	spreadsheetId: string,
	range: string,
): Promise<string[][]> {
	const sheets = google.sheets({ version: 'v4', auth: auth as unknown });
	const res = await sheets.spreadsheets.values.get({
		spreadsheetId,
		range,
	});
	return (res.data.values as string[][]) || [];
}

/**
 *
 * @param auth
 * @param spreadsheetId
 * @param sheetId
 */
export async function getSheetProperties(
	auth: Auth,
	spreadsheetId: string,
	sheetId: number,
): Promise<sheets_v4.Schema$Sheet | undefined> {
	const sheets = google.sheets({ version: 'v4', auth: auth as unknown });
	const res = await sheets.spreadsheets.get({
		spreadsheetId,
		includeGridData: false,
	});
	return res.data.sheets?.find((s) => s.properties?.sheetId === sheetId);
}

/**
 *
 * @param prefix
 */
export function testSheetName(prefix: string): string {
	return `__test_${prefix}_${Date.now()}`;
}

export interface CrawlResult {
	archive: Archive;
	tmpDir: string;
	cwd: string;
}

/**
 *
 * @param urls
 * @param options
 */
export async function crawlTestServer(
	urls: string[],
	options?: Record<string, unknown>,
): Promise<CrawlResult> {
	const cwd = path.join(os.tmpdir(), `nitpicker-api-${crypto.randomUUID()}`);
	await fs.mkdir(cwd, { recursive: true });

	const orchestrator = await CrawlerOrchestrator.crawling(
		urls,
		{
			cwd,
			interval: 0,
			parallels: 1,
			image: false,
			...options,
		},
		(q) => {
			q.on('error', (e) => {
				console.error('[nitpicker:api-test] error:', e); // eslint-disable-line no-console
			});
		},
	);

	return {
		archive: orchestrator.archive,
		tmpDir: orchestrator.archive.tmpDir,
		cwd,
	};
}

/**
 *
 * @param result
 */
export async function cleanupCrawl(result: CrawlResult) {
	await fs.rm(result.cwd, { recursive: true, force: true });
}
