import type { CreateSheet } from '../sheets/types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { streamAllImages } from '@nitpicker/query';

import { createCellData } from '../sheets/create-cell-data.js';
import { defaultCellFormat } from '../sheets/default-cell-format.js';

/**
 * Counts every `image_items` row, for `estimateRowCount()`.
 * @param accessor - The archive accessor to query.
 */
async function countImages(accessor: ArchiveAccessor): Promise<number> {
	const knex = accessor.getKnex();
	const [row] = await knex('image_items').count<{ count: string | number }[]>({
		count: '*',
	});
	return Number(row?.count ?? 0);
}

/**
 * Creates the "Images" sheet configuration.
 *
 * Reports every `<img>` element's attributes (src, currentSrc, alt,
 * dimensions, lazy loading, DOM position) via `streamAllImages` — a plain
 * `image_items` keyset sweep (write-model, populated at crawl time; see
 * that function's docs for why it bypasses the viewer UI's
 * `listViewerImages`/`viewer_images`).
 *
 * The pre-rewrite version instead re-fetched each internal page's full
 * HTML snapshot and re-parsed it with `jsdom` per page (`page.getHtml()` +
 * `new JSDOM(html)`), to resolve `src`/`currentSrc` after base-URL
 * resolution — the only sheet that did so. `image_items` already stores
 * those resolved values from crawl time, so this sheet no longer needs
 * `jsdom` or HTML-blob decompression at all.
 *
 * `requiresReadModel: true` holds regardless of `streamAllImages`' own
 * write-model-only dependency: this flag governs the `viewer-build`
 * gate `report.ts` enforces before running any selected sheet (see
 * `sheets/types.ts`), not each sheet's individual data source, so it is
 * set independently of which tables a given sheet's `run()` happens to
 * read.
 *
 * `Source Code` (the `<img>`'s `outerHTML`) is dropped: the 0.13 schema
 * deliberately does not store it (see `image_items.dom_path_text_id`'s DDL
 * comment) — replaced by `DOM Path`, a stable structural locator
 * (e.g. `html/body[1]/main[1]/img[1]`) derived from the same crawl-time
 * capture.
 * @param _reports
 * @param accessor
 */
export const createImageList: CreateSheet = (_reports, accessor) => {
	return {
		name: 'Images',
		requiresReadModel: true,
		createHeaders() {
			return [
				'Page URL',
				'Image path (src)',
				'Image Path (currentSrc)',
				'Alternative Text',
				'Displayed Width',
				'Displayed Height',
				'Lazy Loading',
				'DOM Path',
			];
		},
		estimateRowCount: () => countImages(accessor),
		async run({ sheet, maxRows, estimatedTotal, onProgress }) {
			let sent = 0;
			const total = estimatedTotal;
			for await (const chunk of streamAllImages(accessor)) {
				for (const item of chunk) {
					if (sent >= maxRows) {
						await sheet.flush();
						return;
					}
					await sheet.appendRow([
						createCellData({ value: item.pageUrl }, defaultCellFormat),
						createCellData({ value: item.src }, defaultCellFormat),
						createCellData({ value: item.currentSrc }, defaultCellFormat),
						createCellData({ value: item.alt }, defaultCellFormat),
						createCellData({ value: item.width }, defaultCellFormat),
						createCellData({ value: item.height }, defaultCellFormat),
						createCellData({ value: item.isLazy }, defaultCellFormat),
						createCellData({ value: item.domPath }, defaultCellFormat),
					]);
					sent++;
					onProgress(sent, total);
				}
			}
			await sheet.flush();
		},
	};
};
