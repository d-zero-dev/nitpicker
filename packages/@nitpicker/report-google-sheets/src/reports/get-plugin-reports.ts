import type { Archive } from '@nitpicker/crawler';
import type { Report } from '@nitpicker/types';

import { reportLog } from '../debug.js';

/**
 * Retrieves analyze plugin reports stored in the archive.
 * Returns an empty array if no reports are found.
 * @param archive - The opened archive to read plugin reports from
 * @returns An array of plugin report data
 */
export async function getPluginReports(archive: Archive) {
	const reports: Report[] = [];

	reportLog('Load');
	try {
		const report = await archive.getData<Report>('analysis/report');
		if (report) {
			reports.push(report);
		}
	} catch {
		reportLog('Failed: report is not found');
	}

	return reports;
}
