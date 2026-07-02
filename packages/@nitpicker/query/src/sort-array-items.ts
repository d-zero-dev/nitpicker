import { sortUrl } from '@d-zero/shared/sort-url';

/**
 * Mirrors SQL-backed list ordering for in-memory computed datasets, keeping
 * computed views sortable without introducing temporary database tables for
 * data that never existed as rows.
 * @param items
 * @param sortBy
 * @param sortOrder
 * @param config - URL fields delegate rank generation to `@d-zero/shared/sort-url`.
 * @example
 * const rows = sortArrayItems(items, 'url', 'asc', {
 *   url: { getValue: (item) => item.url, type: 'url' },
 *   count: { getValue: (item) => item.count },
 * });
 */
export function sortArrayItems<T, TSortBy extends string>(
	items: T[],
	sortBy: TSortBy,
	sortOrder: 'asc' | 'desc' | undefined,
	config: Record<
		TSortBy,
		{ getValue: (item: T) => string | number | boolean | null; type?: 'url' }
	>,
): T[] {
	const direction = sortOrder === 'desc' ? -1 : 1;
	const field = config[sortBy];
	const rankByUrl =
		field.type === 'url'
			? buildRankByUrl(items.map((item) => String(field.getValue(item) ?? '')))
			: undefined;
	return items.toSorted((a, b) => {
		const aValue = field.getValue(a);
		const bValue = field.getValue(b);
		if (rankByUrl) {
			return (
				((rankByUrl.get(String(aValue ?? '')) ?? Number.MAX_SAFE_INTEGER) -
					(rankByUrl.get(String(bValue ?? '')) ?? Number.MAX_SAFE_INTEGER)) *
				direction
			);
		}
		return comparePrimitive(aValue, bValue) * direction;
	});
}

/**
 *
 * @param urls
 */
function buildRankByUrl(urls: readonly string[]): Map<string, number> {
	const rankByUrl = new Map<string, number>();
	for (const [rank, parsed] of sortUrl([...new Set(urls)]).entries()) {
		if (!rankByUrl.has(parsed.href)) rankByUrl.set(parsed.href, rank);
		if (!rankByUrl.has(parsed.withoutHashAndAuth)) {
			rankByUrl.set(parsed.withoutHashAndAuth, rank);
		}
	}
	return rankByUrl;
}

/**
 *
 * @param a
 * @param b
 */
function comparePrimitive(
	a: string | number | boolean | null,
	b: string | number | boolean | null,
): number {
	if (a == null && b == null) return 0;
	if (a == null) return 1;
	if (b == null) return -1;
	if (typeof a === 'number' && typeof b === 'number') return a - b;
	if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
	return String(a).localeCompare(String(b));
}
