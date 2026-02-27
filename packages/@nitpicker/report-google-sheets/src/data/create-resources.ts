import type { CreateSheet } from '../sheets/types.js';

import { reportLog } from '../debug.js';
import { createCellData } from '../sheets/create-cell-data.js';
import { defaultCellFormat } from '../sheets/default-cell-format.js';

/**
 * Creates the "Resources" sheet configuration.
 *
 * Lists all network resources (CSS, JS, images, fonts, etc.) discovered
 * during crawling, with one row per unique resource URL. Each row includes
 * HTTP status, content type, size, and the number of pages that reference
 * the resource (with URLs listed in the cell note).
 *
 * Uses `eachResource` (Phase 3) to iterate over the archive's resource
 * table rather than page-by-page iteration.
 */
export const createResources: CreateSheet = () => {
	return {
		name: 'Resources',
		createHeaders() {
			return [
				'URL',
				'Status Code',
				'Status Text',
				'Content Type',
				'Content Length',
				'Referrers',
			];
		},
		async eachResource(resource) {
			reportLog(`Read: Resource referrers (Search: ${resource.url})`);
			const referrers = await resource.getReferrers();
			const data = [
				createCellData({ value: resource.url }, defaultCellFormat),
				createCellData({ value: resource.status }, defaultCellFormat),
				createCellData({ value: resource.statusText }, defaultCellFormat),
				createCellData({ value: resource.contentType }, defaultCellFormat),
				createCellData({ value: resource.contentLength }, defaultCellFormat),
				createCellData(
					{
						value: `${referrers.length} pages`,
						note: referrers.join('\n'),
					},
					defaultCellFormat,
				),
			];
			return [data];
		},
	};
};
