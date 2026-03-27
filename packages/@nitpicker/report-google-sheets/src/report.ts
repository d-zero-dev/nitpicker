import type { ErrorHandlerMessage } from '@d-zero/google-sheets';

import { Lanes } from '@d-zero/dealer';
import { authentication } from '@d-zero/google-auth';
import { Sheets } from '@d-zero/google-sheets';
import c from 'ansi-colors';

import { getArchive } from './archive.js';
import { buildCreateSheetListFromChoices } from './build-create-sheet-list.js';
import { addToSummary } from './data/add-to-summary.js';
import { archiveLog, log } from './debug.js';
import { loadConfig } from './load-config.js';
import { getPluginReports } from './reports/get-plugin-reports.js';
import { selectReportSheetChoices } from './select-report-sheet-choices.js';
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
	/** When `true`, generate all sheets without interactive prompt. */
	readonly all?: boolean;
	/** When `true`, suppress progress display output. */
	readonly silent?: boolean;
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
	const { filePath, sheetUrl, credentialFilePath, configPath, limit, all, silent } =
		params;
	log('Initialization');

	const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'] as const;
	log('Authenticating');
	const auth = await authentication(credentialFilePath, SCOPES, {
		tokenFilePath: 'token.json',
	});
	log('Authentication succeeded');

	log('Opening archive: %s', filePath);
	const { archive, removeSignalHandlers } = await getArchive(filePath);
	log('Archive opened');

	try {
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

		if (all) {
			log('All sheets selected (--all or non-TTY)');
		} else {
			log('Choice creating data');
		}

		const selectedSheetNames = await selectReportSheetChoices(!!all);
		if (selectedSheetNames == null) {
			log('Choice creating data');
			return;
		}

		log('Chosen sheets: %O', selectedSheetNames);

		const createSheetList = buildCreateSheetListFromChoices(selectedSheetNames);

		if (createSheetList.length === 0) {
			if (!silent) {
				// eslint-disable-next-line no-console
				console.error(
					c.yellow(
						'No data sheets match your selection. "Summary" has no table export; pick at least one other sheet.',
					),
				);
			}
			log('createSheetList empty for selection');
			return;
		}

		if (!silent) {
			// eslint-disable-next-line no-console
			console.log(`\nGenerating ${createSheetList.length} sheet(s)...\n`);
		}

		const lanes = silent
			? null
			: new Lanes({ verbose: !process.stdout.isTTY, indent: '  ' });
		log('Lanes created (verbose: %s, silent: %s)', !process.stdout.isTTY, !!silent);

		const RATE_LIMIT_LANE = 10_000;
		let countdownSeq = 0;
		let waitingCount = 0;

		if (lanes) {
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
		}

		log('Reporting starts (limit: %d)', limit);
		try {
			await createSheets({
				sheets,
				archive,
				reports,
				limit,
				createSheetList,
				options: lanes ? { lanes } : undefined,
			});
		} finally {
			lanes?.close();
		}
		log('Reporting done');
		if (!silent) {
			// eslint-disable-next-line no-console
			console.log('\nReport complete.');
		}

		if (selectedSheetNames.includes('Summary')) {
			await addToSummary(/*sheets, archive, reports*/);
		}
	} finally {
		archiveLog('Closes file');
		removeSignalHandlers();
		await archive.close();
		log('Done');
	}
}
