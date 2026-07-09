import type { Archive } from '@nitpicker/crawler';
import type { Report } from '@nitpicker/types';

import { getViolations } from '@nitpicker/query';

import { reportLog } from '../debug.js';

const VIOLATION_CHUNK_SIZE = 5000;

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

	try {
		const violations = [];
		let offset = 0;
		let total = 0;
		do {
			const page = await getViolations(archive, {
				limit: VIOLATION_CHUNK_SIZE,
				offset,
			});
			total = page.total;
			violations.push(...page.items);
			if (page.items.length === 0) {
				break;
			}
			offset += page.items.length;
		} while (offset < total);
		if (violations.length > 0) {
			reports.push({
				name: 'violations',
				violations,
			});
		}
	} catch {
		reportLog('Failed: violations are not found');
	}

	return reports;
}
