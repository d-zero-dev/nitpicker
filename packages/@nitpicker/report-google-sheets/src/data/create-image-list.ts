import type { CreateSheet } from '../sheets/types.js';
import type { Cell } from '@d-zero/google-sheets';

import { JSDOM } from 'jsdom';

import { createCellData } from '../sheets/create-cell-data.js';
import { defaultCellFormat } from '../sheets/default-cell-format.js';

/**
 * Creates the "Images" sheet configuration.
 *
 * Extracts all `<img>` elements from each internal page's HTML and
 * reports their attributes (src, currentSrc, alt, dimensions, lazy loading).
 * Uses JSDOM to parse the HTML so that resolved `src` URLs (after base URL
 * resolution) and `currentSrc` (for `<picture>` / `srcset`) are available.
 *
 * External pages are skipped because their HTML snapshots are not stored
 * in the archive.
 */
export const createImageList: CreateSheet = () => {
	return {
		name: 'Images',
		createHeaders() {
			return [
				'Page URL',
				'Image path (src)',
				'Image Path (currentSrc)',
				'Alternative Text',
				'Displayed Width',
				'Displayed Height',
				// 'Original Width',
				// 'Original Height',
				// 'Fit Width Rate',
				// 'Fit Height Rate',
				'Lazy Loading',
				'Source Code',
			];
		},

		async eachPage(page) {
			if (!page.isInternalPage()) {
				return;
			}

			const html = await page.getHtml();
			if (!html) {
				return;
			}
			const dom = new JSDOM(html, { url: page.url.href });
			const imgs = dom.window.document.querySelectorAll('img');

			const imgData: Cell[][] = [];

			for (const img of imgs) {
				const data = [
					createCellData({ value: page.url.href }, defaultCellFormat),
					createCellData({ value: img.src }, defaultCellFormat),
					createCellData({ value: img.currentSrc }, defaultCellFormat),
					createCellData({ value: img.alt }, defaultCellFormat),
					createCellData({ value: img.width }, defaultCellFormat),
					createCellData({ value: img.height }, defaultCellFormat),
					// createCellData({ value: img.naturalWidth }, defaultCellFormat),
					// createCellData({ value: img.naturalHeight }, defaultCellFormat),
					createCellData({ value: img.loading === 'lazy' }, defaultCellFormat),
					createCellData({ value: img.outerHTML }, defaultCellFormat),
				];

				imgData.push(data);
			}

			return imgData;
		},
	};
};
