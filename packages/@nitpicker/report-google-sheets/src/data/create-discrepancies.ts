import type { CreateSheet } from '../sheets/types.js';

import { pLog } from '../debug.js';
import { createCellData } from '../sheets/create-cell-data.js';
import { defaultCellFormat } from '../sheets/default-cell-format.js';

const log = pLog.extend('Discrepancies');

/**
 * Creates the "Discrepancies" sheet configuration.
 *
 * Lists cross-page discrepancies produced by analyze plugins (e.g. meta tag
 * consistency checks).
 *
 * The pre-rewrite version also compared every anchor's `textContent`
 * against its `title` attribute (a "Link Text vs Page Title" check, despite
 * the label — it never actually compared to the destination page's
 * `<title>`). That check is dropped: an anchor's `title` attribute is not
 * stored anywhere in the 0.13 write model or the viewer read model (only
 * `anchor_edges.first_text_id`/`viewer_anchor_facts.first_text_id`, the
 * `textContent`, survive), so there is no data left to compare against.
 * @param reports - Analyze plugin reports to extract discrepancy data from.
 */
export const createDiscrepancies: CreateSheet = (reports) => {
	return {
		name: 'Discrepancies',
		createHeaders() {
			return ['Type', 'Left URL', 'Left', 'Right', 'Right URL', 'Note'];
		},
		estimateRowCount() {
			let count = 0;
			for (const report of reports) {
				count += report.discrepancies?.length ?? 0;
			}
			return count;
		},
		async run({ sheet, maxRows, onProgress }) {
			let sent = 0;
			const total = reports.reduce((sum, r) => sum + (r.discrepancies?.length ?? 0), 0);
			for (const report of reports) {
				if (!report.discrepancies) {
					continue;
				}
				log('From %s', report.name);
				for (const discrepancy of report.discrepancies) {
					if (sent >= maxRows) {
						await sheet.flush();
						return;
					}
					await sheet.appendRow([
						createCellData({ value: report.name }, defaultCellFormat),
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
					sent++;
					onProgress(sent, total);
				}
			}
			await sheet.flush();
		},
	};
};
