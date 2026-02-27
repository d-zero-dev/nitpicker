import type { CreateSheet } from '../sheets/types.js';
import type { Cell } from '@d-zero/google-sheets';

import { pLog } from '../debug.js';
import { createCellData } from '../sheets/create-cell-data.js';
import { defaultCellFormat } from '../sheets/default-cell-format.js';

const log = pLog.extend('Violations');

/**
 * Creates the "Violations" sheet configuration.
 *
 * Aggregates all violations from analyze plugin reports into a single
 * flat table. Uses `addRows` (Phase 4) rather than `eachPage` because
 * violation data comes from the report objects, not from per-page
 * archive iteration. This means it runs in parallel with page/resource
 * processing phases.
 * @param reports
 */
export const createViolations: CreateSheet = (reports) => {
	return {
		name: 'Violations',
		createHeaders() {
			return ['Validator', 'Severity', 'Rule', 'Code', 'Message', 'URL'];
		},
		addRows: () => {
			const data: Cell[][] = [];
			for (const report of reports) {
				if (!report.violations) {
					continue;
				}
				log('From %s', report.name);
				for (const violation of report.violations) {
					data.push([
						createCellData({ value: violation.validator }, defaultCellFormat),
						createCellData({ value: violation.severity }, defaultCellFormat),
						createCellData({ value: violation.rule }, defaultCellFormat),
						createCellData({ value: violation.code }, defaultCellFormat),
						createCellData({ value: violation.message }, defaultCellFormat),
						createCellData({ value: violation.url }, defaultCellFormat),
					]);
				}
			}
			return data;
		},
	};
};
