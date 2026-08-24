import type { CreateSheet } from '../sheets/types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { streamAllViolations } from '@nitpicker/query';

import { createCellData } from '../sheets/create-cell-data.js';
import { defaultCellFormat } from '../sheets/default-cell-format.js';

/**
 * Counts every `analysis_violations` row, for `estimateRowCount()`.
 * @param accessor - The archive accessor to query.
 */
async function countViolations(accessor: ArchiveAccessor): Promise<number> {
	const knex = accessor.getKnex();
	const [row] = await knex('analysis_violations').count<{ count: string | number }[]>({
		count: '*',
	});
	return Number(row?.count ?? 0);
}

/**
 * Creates the "Violations" sheet configuration.
 *
 * Streams `streamAllViolations` — a plain `analysis_violations.id` keyset
 * pass, unlike the pre-rewrite version, which pre-loaded every violation
 * into a `Report.violations` array before generation started (via
 * `getPluginReports`). No read-model dependency: `analysis_violations` is a
 * write-model table.
 * @param _reports - Unused; the Violations sheet has no plugin-report dependency.
 * @param accessor - The archive accessor to query.
 */
export const createViolations: CreateSheet = (_reports, accessor) => {
	return {
		name: 'Violations',
		createHeaders() {
			return ['Validator', 'Severity', 'Rule', 'Code', 'Message', 'URL'];
		},
		estimateRowCount: () => countViolations(accessor),
		async run({ sheet, maxRows, estimatedTotal, onProgress }) {
			let sent = 0;
			const total = estimatedTotal;
			for await (const chunk of streamAllViolations(accessor)) {
				for (const violation of chunk) {
					if (sent >= maxRows) {
						await sheet.flush();
						return;
					}
					await sheet.appendRow([
						createCellData({ value: violation.validator }, defaultCellFormat),
						createCellData({ value: violation.severity }, defaultCellFormat),
						createCellData({ value: violation.rule }, defaultCellFormat),
						createCellData({ value: violation.code }, defaultCellFormat),
						createCellData({ value: violation.message }, defaultCellFormat),
						createCellData({ value: violation.url }, defaultCellFormat),
					]);
					sent++;
					onProgress(sent, total);
				}
			}
			await sheet.flush();
		},
	};
};
