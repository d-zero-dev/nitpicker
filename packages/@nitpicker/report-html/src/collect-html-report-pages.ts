import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { HtmlReportPage } from '@nitpicker/viewer/report-ui';

import {
	buildRedirectFromUrlsByDestId,
	getResourceFileCountsByPageIds,
	streamPageListRows,
} from '@nitpicker/query';

/**
 * Collects inner-page rows for a static HTML report in `natural_url_rank`
 * order, attaching redirect sources and per-page resource-file tallies.
 * @param accessor - Archive whose viewer read model is already current.
 * @param directories - Directory-prefix filters. Empty or omitted lists every inner page.
 * @returns Page rows ready for `renderHtmlReport`.
 * @example
 * const pages = await collectHtmlReportPages(accessor, ['/docs']);
 */
export async function collectHtmlReportPages(
	accessor: ArchiveAccessor,
	directories: readonly string[] = [],
): Promise<HtmlReportPage[]> {
	const redirectFrom = await buildRedirectFromUrlsByDestId(accessor);
	const pages: HtmlReportPage[] = [];

	for await (const chunk of streamPageListRows(accessor, { directories })) {
		const counts = await getResourceFileCountsByPageIds(
			accessor,
			chunk.map((row) => row.pageId),
		);
		for (const row of chunk) {
			const resources = counts.get(row.pageId) ?? { total: 0, exists: 0 };
			pages.push({
				title: row.title,
				url: row.url,
				status: row.status,
				redirectChain: [...(redirectFrom.get(row.pageId) ?? [])].toSorted((left, right) =>
					left.localeCompare(right),
				),
				metaDescription: row.description,
				resourceFilesExists: resources.exists,
				resourceFilesTotal: resources.total,
				consoleErrorCount: row.consoleErrorCount,
			});
		}
	}

	return pages;
}
