import type { CreateSheet } from '../sheets/types.js';

import { streamResourceReferrerEdges } from '@nitpicker/query';

import { pLog } from '../debug.js';
import { createCellData } from '../sheets/create-cell-data.js';
import { defaultCellFormat } from '../sheets/default-cell-format.js';
import { booleanFormatError } from '../sheets/format.js';

const log = pLog.extend('ResourcesRelationalTable');

/**
 * Creates the "Resources Relational Table" sheet configuration.
 *
 * Produces a normalized many-to-many table linking each network
 * resource (CSS, JS, images, fonts, etc.) to the pages that
 * reference it. Each row represents one page-to-resource
 * relationship with the resource's HTTP status and size metadata.
 *
 * Unlike the "Resources" sheet which shows one row per resource
 * with a referrer count, this relational table enables filtering
 * and pivot analysis -- e.g. "which pages load this broken CSS file?"
 *
 * No read-model dependency: reads `resource_ref_edges` directly (write
 * model), the same table `resource.getReferrers()` ultimately queried
 * pre-rewrite — this sheet replaces that per-resource N+1 query pattern
 * with one streamed scan.
 * @param _reports
 * @param accessor
 */
export const createResourcesRelationalTable: CreateSheet = (_reports, accessor) => {
	return {
		name: 'Resources Relational Table',
		createHeaders() {
			return [
				'Referred Page (From)',
				'Resource (To)',
				'Resource Status Code',
				'Resource Status Text',
				'Resource Content Type',
				'Resource Size',
			];
		},
		async estimateRowCount() {
			const knex = accessor.getKnex();
			const [row] = await knex('resource_ref_edges').count<{ count: string | number }[]>({
				count: '*',
			});
			return Number(row?.count ?? 0);
		},
		async run({ sheet, maxRows, estimatedTotal, onProgress }) {
			let sent = 0;
			const total = estimatedTotal;
			for await (const chunk of streamResourceReferrerEdges(accessor)) {
				for (const edge of chunk) {
					if (sent >= maxRows) {
						await sheet.flush();
						return;
					}
					await sheet.appendRow([
						createCellData(
							{ value: edge.pageUrl, textFormat: { link: { uri: edge.pageUrl } } },
							defaultCellFormat,
						),
						createCellData({ value: edge.resourceUrl }, defaultCellFormat),
						createCellData({ value: edge.status }, defaultCellFormat),
						createCellData({ value: edge.statusText }, defaultCellFormat),
						createCellData({ value: edge.contentType }, defaultCellFormat),
						createCellData({ value: edge.contentLength }, defaultCellFormat),
					]);
					sent++;
					onProgress(sent, total);
				}
			}
			await sheet.flush();
		},
		async updateSheet(sheet) {
			await sheet.frozen(2, 1);

			await sheet.conditionalFormat(
				[sheet.getColNumByHeaderName('Resource Status Code')],
				{
					booleanRule: {
						condition: {
							type: 'NUMBER_GREATER_THAN_EQ',
							values: [{ userEnteredValue: '400' }],
						},
						format: booleanFormatError,
					},
				},
			);

			await sheet.conditionalFormat(
				[sheet.getColNumByHeaderName('Resource Status Code')],
				{
					booleanRule: {
						condition: {
							type: 'NUMBER_NOT_BETWEEN',
							values: [{ userEnteredValue: '200' }, { userEnteredValue: '399' }],
						},
						format: booleanFormatError,
					},
				},
			);
			log('Formatting applied');
		},
	};
};
