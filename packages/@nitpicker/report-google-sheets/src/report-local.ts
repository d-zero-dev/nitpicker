import path from 'node:path';

import { Lanes } from '@d-zero/dealer';
import c from 'ansi-colors';

import { getArchive } from './archive.js';
import { buildCreateSheetListFromChoices } from './build-create-sheet-list.js';
import { addToSummary } from './data/add-to-summary.js';
import { archiveLog, log } from './debug.js';
import { loadConfig } from './load-config.js';
import { getPluginReports } from './reports/get-plugin-reports.js';
import { selectReportSheetChoices } from './select-report-sheet-choices.js';
import { BufferedSpreadsheet } from './sheets/buffered-spreadsheet.js';
import { createSheets } from './sheets/create-sheets.js';
import { writeReportTsvDirectory } from './tsv/write-report-tsv-directory.js';

/**
 * Parameters for `reportLocal`.
 */
export interface ReportLocalParams {
	/** Path to the `.nitpicker` archive file. */
	readonly filePath: string;
	/** Directory to write `.tsv` files into (created if missing). */
	readonly outputDir: string;
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
 * Runs the same report data pipeline as `report`, but writes tab-separated
 * files to the directory given by `params.outputDir` instead of Google Sheets.
 * @param params - Local report options.
 */
export async function reportLocal(params: ReportLocalParams) {
	const { filePath, outputDir, configPath, limit, all, silent } = params;
	log('Initialization (local TSV)');

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

		log('Reporting starts (local)');

		const selectedSheetNames = await selectReportSheetChoices(!!all);
		if (selectedSheetNames == null) {
			log('Choice creating data');
			return;
		}

		log('Chosen sheets: %O', selectedSheetNames);

		const createSheetList = buildCreateSheetListFromChoices(selectedSheetNames);

		if (!silent) {
			// eslint-disable-next-line no-console
			console.log(`\nGenerating ${createSheetList.length} sheet(s)...\n`);
		}

		const lanes = silent
			? null
			: new Lanes({ verbose: !process.stdout.isTTY, indent: '  ' });
		log('Lanes created (verbose: %s, silent: %s)', !process.stdout.isTTY, !!silent);

		const spreadsheet = new BufferedSpreadsheet();

		log('Reporting starts (limit: %d)', limit);
		try {
			await createSheets({
				sheets: spreadsheet,
				archive,
				reports,
				limit,
				createSheetList,
				options: lanes ? { lanes } : undefined,
			});
		} finally {
			lanes?.close();
		}

		await writeReportTsvDirectory(outputDir, spreadsheet.getTabSnapshots());

		log('Reporting done');
		if (!silent) {
			// eslint-disable-next-line no-console
			console.log(c.green(`\nTSV report written to ${path.resolve(outputDir)}\n`));
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
