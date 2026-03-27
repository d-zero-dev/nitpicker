import type { CreateSheet } from './sheets/types.js';

import { createDiscrepancies } from './data/create-discrepancies.js';
import { createImageList } from './data/create-image-list.js';
import { createLinks } from './data/create-links.js';
import { createPageList } from './data/create-page-list.js';
import { createReferrersRelationalTable } from './data/create-referrers-relational-table.js';
import { createResourcesRelationalTable } from './data/create-resources-relational-table.js';
import { createResources } from './data/create-resources.js';
import { createViolations } from './data/create-violations.js';

/**
 * Builds the `createSheet` factory list for `createSheets` from user-selected tab names.
 * @param selectedSheetNames - Subset of labels from `report-sheet-choice-names.ts`.
 * @returns Ordered list of sheet factories (Summary is not a data sheet here).
 */
export function buildCreateSheetListFromChoices(
	selectedSheetNames: readonly string[],
): CreateSheet[] {
	const createSheetList: CreateSheet[] = [];

	if (selectedSheetNames.includes('Page List')) {
		createSheetList.push(createPageList);
	}

	if (selectedSheetNames.includes('Links')) {
		createSheetList.push(createLinks);
	}

	if (selectedSheetNames.includes('Discrepancies')) {
		createSheetList.push(createDiscrepancies);
	}

	if (selectedSheetNames.includes('Violations')) {
		createSheetList.push(createViolations);
	}

	if (selectedSheetNames.includes('Referrers Relational Table')) {
		createSheetList.push(createReferrersRelationalTable);
	}

	if (selectedSheetNames.includes('Resources Relational Table')) {
		createSheetList.push(createResourcesRelationalTable);
	}

	if (selectedSheetNames.includes('Resources')) {
		createSheetList.push(createResources);
	}

	if (selectedSheetNames.includes('Images')) {
		createSheetList.push(createImageList);
	}

	return createSheetList;
}
