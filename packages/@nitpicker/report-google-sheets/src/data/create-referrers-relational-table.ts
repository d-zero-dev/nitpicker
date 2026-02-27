import type { CreateSheet } from '../sheets/types.js';
import type { Cell } from '@d-zero/google-sheets';

import { pLog } from '../debug.js';
import { createCellData } from '../sheets/create-cell-data.js';
import { defaultCellFormat } from '../sheets/default-cell-format.js';
import { booleanFormatError } from '../sheets/format.js';

const log = pLog.extend('ReferrersRelationalTable');

/**
 * Creates the "Referrers Relational Table" sheet configuration.
 *
 * Produces a normalized many-to-many table linking each page to all
 * pages that reference it (referrers). Each row represents one
 * referrer-to-page relationship with the referrer's text content
 * and the page's HTTP status info.
 *
 * This relational format (as opposed to the denormalized referrer
 * column in "Links") enables pivot-table analysis and filtering
 * in Google Sheets -- e.g. "which pages link to this 404 page?"
 *
 * Redirect chains are noted: when the referrer originally linked to
 * a different URL that redirected to the current page, a
 * `[REDIRECTED FROM]` note is added.
 */
export const createReferrersRelationalTable: CreateSheet = () => {
	return {
		name: 'Referrers Relational Table',
		createHeaders() {
			return [
				//
				'Link (To)',
				'Referrer (From)',
				'Referrer Content',
				'Link Status Code',
				'Link Status Text',
				'Link Content Type',
			];
		},
		async eachPage(page, num, total) {
			const p = Math.round((num / total) * 100);
			log('Create relational table (%d%% %d/%d)', p, num, total);

			const data: Cell[][] = [];

			const referrers = await page.getReferrers();

			for (const ref of referrers) {
				const text = ref.textContent || '__NO_TEXT_CONTENT__';
				const url = ref.url + (ref.hash ? `#${ref.hash}` : '');
				const pass =
					page.url.href === ref.through ? '' : `[REDIRECTED FROM] ${ref.through}`;

				data.push([
					createCellData(
						{
							value: page.url.href,
							textFormat: { link: { uri: page.url.href } },
							note: pass === '' ? undefined : pass,
						},
						defaultCellFormat,
					),
					createCellData(
						{
							value: url,
							textFormat: { link: { uri: url } },
						},
						defaultCellFormat,
					),
					createCellData({ value: text }, defaultCellFormat),
					createCellData({ value: page.status || -1 }, defaultCellFormat),
					createCellData({ value: page.statusText || '' }, defaultCellFormat),
					createCellData({ value: page.contentType || '' }, defaultCellFormat),
				]);
			}

			return data;
		},
		async updateSheet(sheet) {
			await sheet.frozen(2, 1);

			await sheet.conditionalFormat([sheet.getColNumByHeaderName('Link Status Code')], {
				booleanRule: {
					condition: {
						type: 'NUMBER_GREATER_THAN_EQ',
						values: [
							{
								userEnteredValue: '400',
							},
						],
					},
					format: booleanFormatError,
				},
			});

			await sheet.conditionalFormat([sheet.getColNumByHeaderName('Link Status Code')], {
				booleanRule: {
					condition: {
						type: 'NUMBER_NOT_BETWEEN',
						values: [
							{
								userEnteredValue: '200',
							},
							{
								userEnteredValue: '399',
							},
						],
					},
					format: booleanFormatError,
				},
			});
		},
	};
};
