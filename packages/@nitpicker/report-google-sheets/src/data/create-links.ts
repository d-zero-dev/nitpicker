import type { CreateSheet } from '../sheets/types.js';

import { getInboundReferrerUrlsByPageIds, streamAllContentItems } from '@nitpicker/query';

import { pLog } from '../debug.js';
import { createCellData } from '../sheets/create-cell-data.js';
import { defaultCellFormat } from '../sheets/default-cell-format.js';
import { booleanFormatError } from '../sheets/format.js';
import { joinUrlsForNote } from '../utils/join-urls-for-note.js';

const log = pLog.extend('Links');

/**
 * Creates the "Links" sheet configuration.
 *
 * Produces one row per `content_items` row — internal, external, skipped,
 * and never-fetched alike (see `streamAllContentItems`'s docs for why this
 * bypasses the viewer read model's `viewer_pages`, which structurally
 * cannot list skipped/never-fetched pages) — with URL, title, HTTP status,
 * content type, redirect chain, referrers, response headers, and remarks.
 * The remarks column shows the skip reason for pages that were skipped
 * during crawling (e.g., blocked by robots.txt, excluded by rules).
 *
 * Referrers are fetched from `viewer_anchor_facts`
 * (`getInboundReferrerUrlsByPageIds`, batched per `streamAllContentItems`
 * chunk) — the `[REDIRECTED FROM] ...` per-anchor note the pre-rewrite
 * version showed (from `page.getReferrers()`'s per-anchor `through` field)
 * is no longer available at this grain: `viewer_anchor_facts` aggregates by
 * `(source, resolved dest)` pair, not by raw anchor observation. This sheet
 * therefore requires the viewer read model (`requiresReadModel: true`).
 *
 * Applies conditional formatting to highlight:
 * - Status codes >= 400 (client/server errors)
 * - Status codes outside the 200-399 range (non-success)
 *
 * The header row and first column are frozen for easier scrolling.
 * @param _reports
 * @param accessor
 */
export const createLinks: CreateSheet = (_reports, accessor) => {
	return {
		name: 'Links',
		requiresReadModel: true,
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
		async estimateRowCount() {
			const knex = accessor.getKnex();
			const [row] = await knex('content_items').count<{ count: string | number }[]>({
				count: '*',
			});
			return Number(row?.count ?? 0);
		},
		async run({ sheet, maxRows, onProgress }) {
			let sent = 0;
			// No cheap running total from `streamAllContentItems` itself (unlike
			// `getViolations`'s `page.total` or `listViewerPages`'s `page.total`)
			// — `maxRows` (from `estimateRowCount`, clamped by the cell budget)
			// doubles as the progress denominator instead.
			const total = maxRows;
			for await (const chunk of streamAllContentItems(accessor)) {
				const referrerUrlsByPageId = await getInboundReferrerUrlsByPageIds(
					accessor,
					chunk.map((row) => row.pageId),
				);

				for (const row of chunk) {
					if (sent >= maxRows) {
						await sheet.flush();
						return;
					}
					const referrerUrls = referrerUrlsByPageId.get(row.pageId) ?? [];

					await sheet.appendRow([
						createCellData(
							{ value: row.url, textFormat: { link: { uri: row.url } } },
							defaultCellFormat,
						),
						createCellData({ value: row.title || '-' }, defaultCellFormat),
						createCellData({ value: row.status ?? -1 }, defaultCellFormat),
						createCellData({ value: row.statusText || '' }, defaultCellFormat),
						createCellData({ value: row.contentType || '' }, defaultCellFormat),
						createCellData(
							{
								value: row.redirectFromUrls.length,
								note: joinUrlsForNote(row.redirectFromUrls),
							},
							defaultCellFormat,
						),
						createCellData(
							{
								value: `${referrerUrls.length} Elements`,
								note: joinUrlsForNote(referrerUrls),
							},
							defaultCellFormat,
						),
						createCellData(
							{
								value: '{}',
								note: JSON.stringify(row.responseHeaders, null, 2),
							},
							defaultCellFormat,
						),
						createCellData(
							{ value: row.isSkipped ? row.skipReason || 'skipped' : '' },
							defaultCellFormat,
						),
					]);
					sent++;
					onProgress(sent, total);
				}
			}
			await sheet.flush();
		},
		async updateSheet(sheet) {
			await sheet.frozen(2, 1);

			await sheet.conditionalFormat([sheet.getColNumByHeaderName('Status Code')], {
				booleanRule: {
					condition: {
						type: 'NUMBER_GREATER_THAN_EQ',
						values: [{ userEnteredValue: '400' }],
					},
					format: booleanFormatError,
				},
			});

			await sheet.conditionalFormat([sheet.getColNumByHeaderName('Status Code')], {
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
