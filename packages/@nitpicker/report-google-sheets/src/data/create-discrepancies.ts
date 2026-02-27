import type { CreateSheet } from '../sheets/types.js';
import type { Cell } from '@d-zero/google-sheets';

import { pLog } from '../debug.js';
import { createCellData } from '../sheets/create-cell-data.js';
import { defaultCellFormat } from '../sheets/default-cell-format.js';

const log = pLog.extend('Discrepancies');

/**
 * Creates the "Discrepancies" sheet configuration.
 *
 * Generates discrepancy data from two sources:
 *
 * 1. **Link Text vs Page Title** (via `eachPage`): For every anchor on
 *    each page, creates a row comparing the link's text content with the
 *    linked page's title. This helps identify misleading or inconsistent
 *    link labels.
 *
 * 2. **Plugin discrepancies** (via `addRows`): Includes any discrepancy data
 *    produced by analyze plugins (e.g. meta tag consistency checks).
 *
 * Both data sources are written to the same sheet, distinguished by
 * the "Type" column.
 * @param reports
 */
export const createDiscrepancies: CreateSheet = (reports) => {
	return {
		name: 'Discrepancies',
		createHeaders() {
			return ['Type', 'Left URL', 'Left', 'Right', 'Right URL', 'Note'];
		},
		async eachPage(page) {
			const anchors = await page.getAnchors();
			const data: Cell[][] = [];
			log('Create text link discrepancies');
			log('Found %d anchors', anchors.length);
			for (const anchor of anchors) {
				data.push([
					createCellData({ value: 'Link Text vs Page Title' }, defaultCellFormat),
					createCellData({ value: page.url.href }, defaultCellFormat),
					createCellData({ value: anchor.textContent }, defaultCellFormat),
					createCellData({ value: anchor.title }, defaultCellFormat),
					createCellData({ value: anchor.url }, defaultCellFormat),
					createCellData({ value: '' }, defaultCellFormat),
				]);
			}
			return data;
		},
		addRows() {
			const data: Cell[][] = [];
			for (const report of reports) {
				if (!report.discrepancies) {
					continue;
				}
				for (const discrepancy of report.discrepancies) {
					data.push([
						createCellData(
							{ value: discrepancy.leftSourceUrl, note: discrepancy.leftSourceUrlNote },
							defaultCellFormat,
						),
						createCellData(
							{ value: discrepancy.left, note: discrepancy.leftNote },
							defaultCellFormat,
						),
						createCellData(
							{ value: discrepancy.right, note: discrepancy.rightNote },
							defaultCellFormat,
						),
						createCellData(
							{ value: discrepancy.rightSourceUrl, note: discrepancy.rightSourceUrlNote },
							defaultCellFormat,
						),
						createCellData({ value: discrepancy.note }, defaultCellFormat),
					]);
				}
			}
			return data;
		},
	};
};
