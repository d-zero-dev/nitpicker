import type { CreateSheet } from './sheets/types.js';
import type { ErrorHandlerMessage } from '@d-zero/google-sheets';

import { Lanes } from '@d-zero/dealer';
import { authentication } from '@d-zero/google-auth';
import { Sheets } from '@d-zero/google-sheets';
import c from 'ansi-colors';
import enquirer from 'enquirer';

import { getArchive } from './archive.js';
import { addToSummary } from './data/add-to-summary.js';
import { createDiscrepancies } from './data/create-discrepancies.js';
import { createImageList } from './data/create-image-list.js';
import { createLinks } from './data/create-links.js';
import { createPageList } from './data/create-page-list.js';
import { createReferrersRelationalTable } from './data/create-referrers-relational-table.js';
import { createResourcesRelationalTable } from './data/create-resources-relational-table.js';
import { createResources } from './data/create-resources.js';
import { createViolations } from './data/create-violations.js';
import { archiveLog, log } from './debug.js';
import { loadConfig } from './load-config.js';
import { getPluginReports } from './reports/get-plugin-reports.js';
import { createSheets } from './sheets/create-sheets.js';

/**
 * Parameters for {@link report}.
 */
export interface ReportParams {
	/** Path to the `.nitpicker` archive file. */
	readonly filePath: string;
	/** URL of the target Google Spreadsheet. */
	readonly sheetUrl: string;
	/** Path to the OAuth2 credentials JSON file. */
	readonly credentialFilePath: string;
	/** Path to the nitpicker config file, or `null` for defaults. */
	readonly configPath: string | null;
	/** Batch size for `getPagesWithRefs()` pagination (default: 100,000). */
	readonly limit: number;
}

/**
 * Generates a Google Sheets report from a `.nitpicker` archive file.
 *
 * This is the main entry point for the `nitpicker report` command.
 * It orchestrates the full reporting pipeline:
 *
 * 1. Authenticates with Google Sheets API using OAuth2 credentials.
 * 2. Opens the `.nitpicker` archive and loads its configuration.
 * 3. Loads analyze plugin reports from the archive.
 * 4. Presents an interactive multi-select prompt for the user to
 *    choose which sheets to generate.
 * 5. Delegates to `createSheets()` for phased data generation and upload.
 *
 * Rate limiting from the Google Sheets API (429 / 403) is handled
 * gracefully via the `Sheets.onLog` callback, which displays a
 * countdown timer in the terminal using the `Lanes` progress display.
 * @param params - レポート生成に必要なパラメータ
 * @example
 * ```ts
 * await report({
 *   filePath: './output.nitpicker',
 *   sheetUrl: 'https://docs.google.com/spreadsheets/d/xxx/edit',
 *   credentialFilePath: './credentials.json',
 *   configPath: './nitpicker.config.json',
 *   limit: 100_000,
 * });
 * ```
 */
export async function report(params: ReportParams) {
	const { filePath, sheetUrl, credentialFilePath, configPath, limit } = params;
	log('Initialization');

	const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'] as const;
	log('Authenticating');
	const auth = await authentication(credentialFilePath, SCOPES, {
		tokenFilePath: 'token.json',
	});
	log('Authentication succeeded');

	log('Opening archive: %s', filePath);
	const archive = await getArchive(filePath);
	log('Archive opened');

	log('Loading config');
	const config = await loadConfig(configPath);
	log('Config loaded');

	const plugins = config.plugins?.analyze
		? Object.keys(config.plugins.analyze)
		: undefined;
	log('Loaded plugins: %O', plugins);

	log('Loading plugin reports');
	const reports = await getPluginReports(archive /*plugins*/);
	log('Plugin reports loaded: %d', reports.length);

	const sheets = new Sheets(sheetUrl, auth);

	log('Reporting starts');

	const sheetNames = [
		'Page List' as const,
		'Links' as const,
		'Resources' as const,
		'Images' as const,
		'Violations' as const,
		'Discrepancies' as const,
		'Summary' as const,
		'Referrers Relational Table' as const,
		'Resources Relational Table' as const,
	];
	type SheetNames = typeof sheetNames;

	log('Choice creating data');
	const chosenSheets = await enquirer
		.prompt<{ sheetName: SheetNames }>([
			{
				message: 'What do you report?',
				name: 'sheetName',
				type: 'multiselect',
				choices: sheetNames,
			},
		])
		.catch(() => {
			// enquirer v2.4.1: Ctrl+C 後に readline を二重 close して
			// ERR_USE_AFTER_CLOSE が unhandled rejection になるため、
			// 即座に終了して回避する
			process.exit(0);
		});

	if (!chosenSheets) {
		log('Choice creating data');
		archiveLog('Closes file');
		await archive.close();
		return;
	}

	log('Chosen sheets: %O', chosenSheets.sheetName);

	const createSheetList: CreateSheet[] = [];

	if (chosenSheets.sheetName.includes('Page List')) {
		createSheetList.push(createPageList);
	}

	if (chosenSheets.sheetName.includes('Links')) {
		createSheetList.push(createLinks);
	}

	if (chosenSheets.sheetName.includes('Discrepancies')) {
		createSheetList.push(createDiscrepancies);
	}

	if (chosenSheets.sheetName.includes('Violations')) {
		createSheetList.push(createViolations);
	}

	if (chosenSheets.sheetName.includes('Referrers Relational Table')) {
		createSheetList.push(createReferrersRelationalTable);
	}

	if (chosenSheets.sheetName.includes('Resources Relational Table')) {
		createSheetList.push(createResourcesRelationalTable);
	}

	if (chosenSheets.sheetName.includes('Resources')) {
		createSheetList.push(createResources);
	}

	if (chosenSheets.sheetName.includes('Images')) {
		createSheetList.push(createImageList);
	}

	// eslint-disable-next-line no-console
	console.log(`\nGenerating ${createSheetList.length} sheet(s)...\n`);

	const lanes = new Lanes({ verbose: !process.stdout.isTTY, indent: '  ' });
	log('Lanes created (verbose: %s)', !process.stdout.isTTY);

	const RATE_LIMIT_LANE = 10_000;
	let countdownSeq = 0;
	let waitingCount = 0;

	sheets.onLog = (message: ErrorHandlerMessage) => {
		if (message.waiting && message.waitTime) {
			waitingCount++;
			const id = `rateLimit_${countdownSeq++}`;
			const label =
				message.message === 'TooManyRequestError'
					? 'Too Many Requests (429)'
					: message.message === 'UserRateLimitExceededError'
						? 'Rate Limit Exceeded (403)'
						: 'Connection Reset';
			lanes.update(
				RATE_LIMIT_LANE,
				c.yellow(`${label}: waiting %countdown(${message.waitTime}, ${id}, s)%s`),
			);
		} else {
			waitingCount--;
			if (waitingCount <= 0) {
				waitingCount = 0;
				lanes.delete(RATE_LIMIT_LANE);
			}
		}
	};

	log('Reporting starts (limit: %d)', limit);
	try {
		await createSheets({
			sheets,
			archive,
			reports,
			limit,
			createSheetList,
			options: { lanes },
		});
	} finally {
		lanes.close();
	}
	log('Reporting done');
	// eslint-disable-next-line no-console
	console.log('\nReport complete.');

	if (chosenSheets.sheetName.includes('Summary')) {
		await addToSummary(/*sheets, archive, reports*/);
	}

	archiveLog('Closes file');
	await archive.close();
	log('Done');
}
