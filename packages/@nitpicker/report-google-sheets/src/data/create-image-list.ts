import type { CreateSheet } from '../sheets/types.js';

import { listViewerImages } from '@nitpicker/query';

import { createCellData } from '../sheets/create-cell-data.js';
import { defaultCellFormat } from '../sheets/default-cell-format.js';

/** `listViewerImages` cursor page size while streaming rows. */
const PAGE_SIZE = 500;

/**
 * Creates the "Images" sheet configuration.
 *
 * Reports every `<img>` element's attributes (src, currentSrc, alt,
 * dimensions, lazy loading, DOM position) via `listViewerImages` — the
 * `image_items` read model, populated at crawl time.
 *
 * The pre-rewrite version instead re-fetched each internal page's full
 * HTML snapshot and re-parsed it with `jsdom` per page (`page.getHtml()` +
 * `new JSDOM(html)`), to resolve `src`/`currentSrc` after base-URL
 * resolution — the only sheet that did so. `image_items` already stores
 * those resolved values from crawl time, so this sheet no longer needs
 * `jsdom` or HTML-blob decompression at all: replaced by the read model's
 * `requiresReadModel: true` dependency instead.
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
		async estimateRowCount() {
			const { total } = await listViewerImages(accessor, { limit: 0 });
			return total;
		},
		async run({ sheet, maxRows, onProgress }) {
			let sent = 0;
			let cursor: string | undefined;
			let total = 0;
			for (;;) {
				const page = await listViewerImages(accessor, { limit: PAGE_SIZE, cursor });
				total = page.total;

				for (const item of page.items) {
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

				if (!page.nextCursor) {
					break;
				}
				cursor = page.nextCursor;
			}
			await sheet.flush();
		},
	};
};
