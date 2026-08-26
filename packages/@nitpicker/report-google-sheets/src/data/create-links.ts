import type { CreateSheet } from '../sheets/types.js';
import type { InboundReferrerDetail } from '@nitpicker/query';

import { getInboundReferrerUrlsByPageIds, streamAllContentItems } from '@nitpicker/query';

import { pLog } from '../debug.js';
import { createCellData } from '../sheets/create-cell-data.js';
import { defaultCellFormat } from '../sheets/default-cell-format.js';
import { booleanFormatError } from '../sheets/format.js';
import { joinUrlsForNote } from '../utils/join-urls-for-note.js';
import { truncateNoteText } from '../utils/truncate-note-text.js';

const log = pLog.extend('Links');

/**
 * Formats one referrer's cell-note line, restoring the pre-rewrite report's
 * `text (url => [REDIRECTED FROM] rawUrl)` shape.
 * @param detail - One referrer's detail from `getInboundReferrerUrlsByPageIds`.
 */
function formatReferrerNoteLine(detail: InboundReferrerDetail): string {
	const text = detail.textContent || '(no text)';
	const redirectSuffix = detail.redirectedFromUrl
		? ` => [REDIRECTED FROM] ${detail.redirectedFromUrl}`
		: '';
	return `${text} (${detail.url}${redirectSuffix})`;
}

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
 * chunk): the "N Elements" count sums every returned detail's
 * `InboundReferrerDetail.count` (the raw per-anchor occurrence tally
 * `viewer_anchor_facts` still carries, even though it stores one row per
 * `(source, resolved dest)` pair rather than one per raw anchor
 * observation), and each note line reconstructs the pre-rewrite report's
 * `text (url => [REDIRECTED FROM] rawUrl)` format from
 * `InboundReferrerDetail.redirectedFromUrl`. This sheet therefore requires
 * the viewer read model (`requiresReadModel: true`).
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
		async run({ sheet, maxRows, estimatedTotal, onProgress }) {
			let sent = 0;
			// No cheap running total from `streamAllContentItems` itself (unlike
			// `getViolations`'s `page.total` or `listViewerPages`'s `page.total`)
			// — `estimatedTotal` (from `estimateRowCount()`, captured once in
			// Phase 1.5) is the progress denominator instead.
			const total = estimatedTotal;
			for await (const chunk of streamAllContentItems(accessor)) {
				const referrerDetailsByPageId = await getInboundReferrerUrlsByPageIds(
					accessor,
					chunk.map((row) => row.pageId),
				);

				for (const row of chunk) {
					if (sent >= maxRows) {
						await sheet.flush();
						return;
					}
					const referrerDetails = referrerDetailsByPageId.get(row.pageId) ?? [];
					// Sum occurrence counts, not `.length`: `referrerDetails` is
					// already deduped to one entry per referring page (see
					// `InboundReferrerDetail.count`'s docs), so counting entries
					// would undercount a page with more than one anchor to the
					// same destination.
					const elementCount = referrerDetails.reduce((sum, d) => sum + d.count, 0);

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
								value: `${elementCount} Elements`,
								note: joinUrlsForNote(referrerDetails.map(formatReferrerNoteLine)),
							},
							defaultCellFormat,
						),
						createCellData(
							{
								value: '{}',
								note: truncateNoteText(JSON.stringify(row.responseHeaders, null, 2)),
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
