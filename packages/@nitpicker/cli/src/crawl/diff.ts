import type { Page } from '@nitpicker/crawler';

import fs from 'node:fs/promises';

import { sortUrl } from '@d-zero/shared/sort-url';
import { Archive } from '@nitpicker/crawler';

/**
 * Compares two `.nitpicker` archives and writes their URL lists to `a.txt` and `b.txt`.
 *
 * Extracts active internal HTML pages (2xx/3xx status) from both archives,
 * sorts them in natural URL order, and writes to the current working directory.
 * The output files can then be compared using standard diff tools.
 * @param a - File path to the first `.nitpicker` archive
 * @param b - File path to the second `.nitpicker` archive
 */
export async function diff(a: string, b: string) {
	const archiveA = await Archive.open({ filePath: a });
	const archiveB = await Archive.open({ filePath: b });
	const pagesA = await archiveA.getPages();
	const pagesB = await archiveB.getPages();
	const listA = pagesA.filter(isActive).map((page) => page.url.withoutHashAndAuth);
	const listB = pagesB.filter(isActive).map((page) => page.url.withoutHashAndAuth);

	const sortedA = sortUrl(listA).map((url) => url.withoutHashAndAuth);
	const sortedB = sortUrl(listB).map((url) => url.withoutHashAndAuth);

	await fs.writeFile('a.txt', sortedA.join('\n'), 'utf8');
	await fs.writeFile('b.txt', sortedB.join('\n'), 'utf8');

	await archiveA.close();
	await archiveB.close();
}

/**
 * Filters for active internal HTML pages (status 200-399, non-external).
 * @param page - The page to check
 * @returns `true` if the page is an active internal HTML page
 */
function isActive(page: Page) {
	return (
		page.isPage() &&
		!page.isExternal &&
		page.status &&
		page.status >= 200 &&
		page.status < 400
	);
}
