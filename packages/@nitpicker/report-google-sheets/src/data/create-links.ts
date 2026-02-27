import type { CreateSheet } from '../sheets/types.js';

import { pLog } from '../debug.js';
import { createCellData } from '../sheets/create-cell-data.js';
import { defaultCellFormat } from '../sheets/default-cell-format.js';
import { booleanFormatError } from '../sheets/format.js';

const log = pLog.extend('Links');

/**
 * Creates the "Links" sheet configuration.
 *
 * Produces one row per crawled page with URL, title, HTTP status,
 * content type, redirect chain, referrers, response headers, and remarks.
 * The remarks column shows the skip reason for pages that were skipped
 * during crawling (e.g., blocked by robots.txt, excluded by rules).
 * Applies conditional formatting to highlight:
 * - Status codes >= 400 (client/server errors)
 * - Status codes outside the 200-399 range (non-success)
 *
 * The header row and first column are frozen for easier scrolling.
 */
export const createLinks: CreateSheet = () => {
	return {
		name: 'Links',
		createHeaders() {
			return [
				'URL',
				'Page Title',
				'Status Code',
				'Status Text',
				'Content Type',
				'Redirect From',
				'Referrers',
				'Headers',
				'Remarks',
			];
		},
		async eachPage(page, num, total) {
			const p = Math.round((num / total) * 100);
			log('Create links (%d%% %d/%d)', p, num, total);

			// if (page.isInternalPage()) {
			// 	return;
			// }

			const referrers = await page.getReferrers();
			const data = [
				createCellData(
					{
						value: page.url.href,
						textFormat: { link: { uri: page.url.href } },
					},
					defaultCellFormat,
				),
				createCellData({ value: page.title || '-' }, defaultCellFormat),
				createCellData({ value: page.status || -1 }, defaultCellFormat),
				createCellData({ value: page.statusText || '' }, defaultCellFormat),
				createCellData({ value: page.contentType || '' }, defaultCellFormat),
				createCellData(
					{
						value: page.redirectFrom.length,
						note: page.redirectFrom.map((r) => r.url).join('\n'),
					},
					defaultCellFormat,
				),
				createCellData(
					{
						value: `${referrers.length} Elements`,
						note: referrers
							.map((ref) => {
								const text = ref.textContent || '__NO_TEXT_CONTENT__';
								const url = ref.url + (ref.hash ? `#${ref.hash}` : '');
								const pass =
									page.url.href === ref.through
										? ''
										: ` => [REDIRECTED FROM] ${ref.through}`;
								return `${text} (${url}${pass})`;
							})
							.join('\n'),
					},
					defaultCellFormat,
				),
				createCellData(
					{
						value: '{}',
						note: JSON.stringify(page.responseHeaders, null, 2),
					},
					defaultCellFormat,
				),
				createCellData(
					{ value: page.isSkipped ? page.skipReason || 'skipped' : '' },
					defaultCellFormat,
				),
			];

			return [data];
		},
		async updateSheet(sheet) {
			await sheet.frozen(2, 1);

			await sheet.conditionalFormat([sheet.getColNumByHeaderName('Status Code')], {
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

			await sheet.conditionalFormat([sheet.getColNumByHeaderName('Status Code')], {
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
