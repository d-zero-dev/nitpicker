import type { PageTechnologyEntry } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Retrieves the full technology star-chart for the page at the given URL:
 * every detected technology (`page_technologies`, confidence descending)
 * with its contributing raw signals (`technology_signals`) inlined.
 *
 * Direct replacement for `getPageTags` — the star-chart's "why was this
 * detected" drill-down that `getPageDetail`'s lightweight
 * `technologies` summary omits.
 * @param accessor - The archive accessor to query.
 * @param url - The page URL.
 * @returns Technology entries with signals, confidence descending, or `[]`
 *   when the page has no detected technologies.
 * @example
 * const technologies = await getPageTechnologies(accessor, 'https://example.com/');
 * const nextjs = technologies.find((t) => t.technology === 'Next.js');
 * console.log(nextjs?.confidence, nextjs?.signals.map((s) => s.signalType));
 */
export async function getPageTechnologies(
	accessor: ArchiveAccessor,
	url: string,
): Promise<PageTechnologyEntry[]> {
	const knex = accessor.getKnex();
	const [page] = await knex('content_items as ci')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.select('ci.id as id')
		.where('ur.url', url)
		.limit(1);
	if (!page) return [];

	const [technologies, signals] = await Promise.all([
		accessor.getPageTechnologiesOfPage(page.id),
		accessor.getTechnologySignalsOfPage(page.id),
	]);

	return technologies.map((t) => ({
		technology: t.technology,
		category: t.category,
		version: t.version,
		confidence: t.confidence,
		signalCount: t.signalCount,
		signals: signals
			.filter((s) => s.technology === t.technology)
			.map((s) => ({
				signalType: s.signalType,
				evidence: s.evidence,
				weight: s.weight,
			})),
	}));
}
