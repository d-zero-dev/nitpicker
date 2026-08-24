import type { CreateSheet } from '../sheets/types.js';

import { streamAnchorFactEdges } from '@nitpicker/query';

import { pLog } from '../debug.js';
import { createCellData } from '../sheets/create-cell-data.js';
import { defaultCellFormat } from '../sheets/default-cell-format.js';
import { booleanFormatError } from '../sheets/format.js';

const log = pLog.extend('ReferrersRelationalTable');

/**
 * Creates the "Referrers Relational Table" sheet configuration.
 *
 * Produces a normalized many-to-many table linking each page to the pages
 * that reference it (referrers). Each row is one `viewer_anchor_facts`
 * edge — a unique `(source, resolved destination)` pair, with an
 * occurrence `Count` column, plus the destination's HTTP status info.
 *
 * This relational format (as opposed to the denormalized referrer
 * column in "Links") enables pivot-table analysis and filtering
 * in Google Sheets -- e.g. "which pages link to this 404 page?"
 *
 * One row per edge (not per raw anchor observation): the redirect/alias
 * resolution that collapses multiple raw anchors into one edge means a
 * per-anchor "redirected from" note is no longer meaningful at this grain
 * for every raw occurrence — but the edge's own raw href (before
 * resolution) is still shown as a note on the "Link (To)" cell whenever it
 * differs from the resolved destination, and the `Count` column reports how
 * many raw anchor occurrences this edge summarizes.
 * @param _reports
 * @param accessor
 */
export const createReferrersRelationalTable: CreateSheet = (_reports, accessor) => {
	return {
		name: 'Referrers Relational Table',
		requiresReadModel: true,
		createHeaders() {
			return [
				'Link (To)',
				'Referrer (From)',
				'Referrer Content',
				'Count',
				'Link Status Code',
				'Link Status Text',
				'Link Content Type',
			];
		},
		async estimateRowCount() {
			const knex = accessor.getKnex();
			const [row] = await knex('viewer_anchor_facts').count<{ count: string | number }[]>(
				{
					count: '*',
				},
			);
			return Number(row?.count ?? 0);
		},
		async run({ sheet, maxRows, estimatedTotal, onProgress }) {
			let sent = 0;
			const total = estimatedTotal;
			for await (const chunk of streamAnchorFactEdges(accessor)) {
				for (const edge of chunk) {
					if (sent >= maxRows) {
						await sheet.flush();
						return;
					}
					const text = edge.textContent || '__NO_TEXT_CONTENT__';
					const redirectedFromNote =
						edge.rawDestUrl === edge.destUrl
							? undefined
							: `Redirected from: ${edge.rawDestUrl}`;

					await sheet.appendRow([
						createCellData(
							{
								value: edge.destUrl,
								textFormat: { link: { uri: edge.destUrl } },
								note: redirectedFromNote,
							},
							defaultCellFormat,
						),
						createCellData(
							{ value: edge.sourceUrl, textFormat: { link: { uri: edge.sourceUrl } } },
							defaultCellFormat,
						),
						createCellData({ value: text }, defaultCellFormat),
						createCellData({ value: edge.count }, defaultCellFormat),
						createCellData({ value: edge.status ?? -1 }, defaultCellFormat),
						createCellData({ value: edge.statusText || '' }, defaultCellFormat),
						createCellData({ value: edge.contentType || '' }, defaultCellFormat),
					]);
					sent++;
					onProgress(sent, total);
				}
			}
			await sheet.flush();
		},
		async updateSheet(sheet) {
			await sheet.frozen(2, 1);

			await sheet.conditionalFormat([sheet.getColNumByHeaderName('Link Status Code')], {
				booleanRule: {
					condition: {
						type: 'NUMBER_GREATER_THAN_EQ',
						values: [{ userEnteredValue: '400' }],
					},
					format: booleanFormatError,
				},
			});

			await sheet.conditionalFormat([sheet.getColNumByHeaderName('Link Status Code')], {
				booleanRule: {
					condition: {
						type: 'NUMBER_NOT_BETWEEN',
						values: [{ userEnteredValue: '200' }, { userEnteredValue: '399' }],
					},
					format: booleanFormatError,
				},
			});
			log('Formatting applied');
		},
	};
};
