import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Report } from '@nitpicker/types';

import { reportLog } from '../debug.js';

/**
 * Retrieves analyze plugin reports stored in the archive's `analysis/report`
 * namespace file — the `pageData`/`discrepancies` source for the Page List
 * and Discrepancies sheets. Returns an empty array if none is found.
 *
 * Violations are deliberately NOT loaded here (unlike the pre-rewrite
 * version, which pre-fetched every `getViolations` page into a synthetic
 * `{ name: 'violations', violations }` report entry): the Violations sheet
 * now calls `getViolations` directly inside its own `run()`, streaming
 * pages as it sends rows instead of holding the full violation set in
 * memory before the first row goes out.
 * @param accessor - The opened archive to read plugin reports from.
 * @returns An array of plugin report data (0 or 1 entries).
 */
export async function getPluginReports(accessor: ArchiveAccessor): Promise<Report[]> {
	const reports: Report[] = [];

	reportLog('Load');
	try {
		const report = await accessor.getData<Report>('analysis/report');
		if (report) {
			reports.push(report);
		}
	} catch {
		reportLog('Failed: report is not found');
	}

	return reports;
}
