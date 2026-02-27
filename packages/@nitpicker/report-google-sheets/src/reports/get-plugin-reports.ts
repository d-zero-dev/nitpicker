import type { Archive } from '@nitpicker/crawler';
import type { Report } from '@nitpicker/types';

import { reportLog } from '../debug.js';

/**
 *
 * @param archive
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
