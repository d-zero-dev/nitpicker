import type { CreateSheet } from './sheets/types.js';

import { authentication } from '@d-zero/google-auth';
import { Sheets } from '@d-zero/google-sheets';
import enquirer from 'enquirer';

import { createDiscrepancies } from './data/create-discrepancies.js';
import { createImageList } from './data/create-image-list.js';
import { createLinks } from './data/create-links.js';
import { createPageList } from './data/create-page-list.js';
import { createReferrersRelationalTable } from './data/create-referrers-relational-table.js';
import { createResourcesRelationalTable } from './data/create-resources-relational-table.js';
import { createResources } from './data/create-resources.js';
import { createViolations } from './data/create-violations.js';
import { log } from './debug.js';
import { loadConfig } from './load-config.js';
import { openReportArchive } from './open-report-archive.js';
import { getPluginReports } from './reports/get-plugin-reports.js';
import { createSheets } from './sheets/create-sheets.js';

/**
 * Every generatable sheet name, in **priority order** — the order
 * `createSheetList` is built in below, which `create-sheets.ts`'s Phase 2
 * treats as the cell-budget allocation priority (see that file's docs).
 * User-visible, more universally useful sheets first; the two relational
 * tables last since their row counts (one row per edge, not per page) are
 * the most likely to explode past the Google Sheets 10M-cell limit.
 */
const SHEET_PRIORITY_ORDER = [
	'Page List',
	'Links',
	'Violations',
	'Discrepancies',
	'Resources',
	'Images',
	'Referrers Relational Table',
	'Resources Relational Table',
	'Summary',
] as const;

type SheetName = (typeof SHEET_PRIORITY_ORDER)[number];

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
	/** When `true`, generate all sheets without interactive prompt. */
	readonly all?: boolean;
	/** When `true`, suppress progress display output. */
	readonly silent?: boolean;
	/**
	 * When `true`, the Resources sheet collapses rows that share the same
	 * canonical URL (query *values* stripped, query *keys* sorted) into
	 * one row per `(canonical URL, status, contentType)` combination,
	 * with an added `Count` column. Useful for archives where tracking
	 * pixels generate millions of per-request unique URLs that would
	 * otherwise exceed Google Sheets' 10M-cell document limit. This field
	 * has no default of its own (omitting it maps to raw mode, like
	 * `false`) — the CLI's `report`/`pipeline` commands default their
	 * `--dedupe-resources` flag to `true` and always pass an explicit
	 * value here.
	 */
	readonly dedupeResources?: boolean;
	/**
	 * Called during the archive-open untar step with bytes read so far and
	 * the archive's total size (issue #294: a large archive's extraction can
	 * take tens of seconds with no other signal it isn't hung). This
	 * package stays UI-agnostic — the caller (the CLI's `report` command)
	 * owns turning this into a display.
	 */
	readonly onExtractProgress?: (readBytes: number, totalBytes: number) => void;
}

/**
 * Generates a Google Sheets report from a `.nitpicker` archive file.
 *
 * This is the main entry point for the `nitpicker report` command.
 * It orchestrates the full reporting pipeline:
 *
 * 1. Authenticates with Google Sheets API using OAuth2 credentials.
 * 2. Opens the `.nitpicker` archive (read-only, via `openReportArchive` —
 *    see that function's docs for why this replaced `Archive.open`).
 * 3. Loads analyze plugin reports from the archive.
 * 4. Presents an interactive multi-select prompt for the user to
 *    choose which sheets to generate.
 * 5. Delegates to `createSheets()` for cell-budget-aware, priority-ordered
 *    data generation and upload, including its `TaskList` progress display
 *    and Google Sheets API rate-limit (429/403/5xx/ECONNRESET) backoff
 *    display — see `create-sheets.ts`'s docs.
 *
 * Cell-budget truncation warnings from `createSheets` are collected and
 * printed via `console.error` only after `createSheets` (and its internal
 * `TaskList` display) has finished, mirroring this file's `console.log`
 * calls, which likewise only ever run outside that active display window.
 * @param params - レポート生成に必要なパラメータ
 * @example
 * ```ts
 * await report({
 *   filePath: './output.nitpicker',
 *   sheetUrl: 'https://docs.google.com/spreadsheets/d/xxx/edit',
 *   credentialFilePath: './credentials.json',
 *   configPath: './nitpicker.config.json',
 * });
 * ```
 */
export async function report(params: ReportParams) {
	const {
		filePath,
		sheetUrl,
		credentialFilePath,
		configPath,
		all,
		silent,
		dedupeResources,
		onExtractProgress,
	} = params;
	log('Initialization');

	const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'] as const;
	log('Authenticating');
	const auth = await authentication(credentialFilePath, SCOPES, {
		tokenFilePath: 'token.json',
	});
	log('Authentication succeeded');

	log('Opening archive: %s', filePath);
	await using archiveHandle = await openReportArchive(filePath, onExtractProgress);
	const { accessor } = archiveHandle;
	log('Archive opened');

	log('Loading config');
	const config = await loadConfig(configPath);
	log('Config loaded');

	const plugins = config.plugins?.analyze
		? Object.keys(config.plugins.analyze)
		: undefined;
	log('Loaded plugins: %O', plugins);

	log('Loading plugin reports');
	const reports = await getPluginReports(accessor);
	log('Plugin reports loaded: %d', reports.length);

	const sheets = new Sheets(sheetUrl, auth);

	log('Reporting starts');

	let selectedSheetNames: SheetName[];

	if (all) {
		log('All sheets selected (--all or non-TTY)');
		selectedSheetNames = [...SHEET_PRIORITY_ORDER];
	} else {
		log('Choice creating data');
		const chosenSheets = await enquirer
			.prompt<{ sheetName: SheetName[] }>([
				{
					message: 'What do you report?',
					name: 'sheetName',
					type: 'multiselect',
					choices: [...SHEET_PRIORITY_ORDER],
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
			return;
		}

		selectedSheetNames = chosenSheets.sheetName;
	}

	log('Chosen sheets: %O', selectedSheetNames);

	const warnings: string[] = [];

	// Priority order is the fixed SHEET_PRIORITY_ORDER, not the user's
	// selection-click order — createSheets's Phase 2 treats array order as
	// the cell-budget allocation priority (see that file's docs).
	const createSheetList: CreateSheet[] = [];
	for (const name of SHEET_PRIORITY_ORDER) {
		if (!selectedSheetNames.includes(name)) {
			continue;
		}
		switch (name) {
			case 'Page List': {
				createSheetList.push(createPageList);
				break;
			}
			case 'Links': {
				createSheetList.push(createLinks);
				break;
			}
			case 'Violations': {
				createSheetList.push(createViolations);
				break;
			}
			case 'Discrepancies': {
				createSheetList.push(createDiscrepancies);
				break;
			}
			case 'Resources': {
				createSheetList.push(createResources({ dedupe: dedupeResources }));
				break;
			}
			case 'Images': {
				createSheetList.push(createImageList);
				break;
			}
			case 'Referrers Relational Table': {
				createSheetList.push(createReferrersRelationalTable);
				break;
			}
			case 'Resources Relational Table': {
				createSheetList.push(createResourcesRelationalTable);
				break;
			}
			case 'Summary': {
				// No-op: the Summary sheet has no generator yet (out of scope
				// for the report rewrite — see `data/add-to-summary.ts`). Warn
				// so a user who explicitly picked it (or ran --all) isn't left
				// wondering why the tab never showed up.
				warnings.push(
					'Warning: "Summary" was selected but is not implemented yet — no Summary sheet will be generated.\n',
				);
				break;
			}
		}
	}

	if (!silent) {
		// eslint-disable-next-line no-console
		console.log(`\nGenerating ${createSheetList.length} sheet(s)...\n`);
	}

	log('Reporting starts');
	await createSheets({
		sheets,
		accessor,
		reports,
		createSheetList,
		options: {
			onWarn: (message) => warnings.push(message),
			silent,
		},
	});
	log('Reporting done');
	for (const warning of warnings) {
		// eslint-disable-next-line no-console
		console.error(warning);
	}
	if (!silent) {
		// eslint-disable-next-line no-console
		console.log('\nReport complete.');
	}
}
