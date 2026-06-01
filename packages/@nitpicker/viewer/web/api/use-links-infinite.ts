import type { LinkEntry, OrphanedPageEntry } from '@nitpicker/query';

import { useInfiniteQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';
import { getNextOffset } from './get-next-offset.js';
import { PAGE_SIZE } from './page-size.js';

/** Link analysis type. */
export type LinkType = 'broken' | 'external' | 'orphaned';

/** A link analysis row: a link (broken/external) or an orphaned page. */
export type LinkRow = LinkEntry | OrphanedPageEntry;

/** Paginated link analysis response shape. */
interface LinksPage {
	/** Rows for this page. */
	items: LinkRow[];
	/** Total matching rows. */
	total: number;
}

/**
 * Infinite-scrolling link analysis (broken / external / orphaned).
 * @param type - The link analysis type.
 * @returns The TanStack infinite-query result.
 */
export function useLinksInfinite(type: LinkType) {
	return useInfiniteQuery({
		queryKey: ['links', type],
		initialPageParam: 0,
		queryFn: ({ pageParam }) =>
			apiGet<LinksPage>('/api/links', {
				type,
				limit: PAGE_SIZE,
				offset: pageParam,
			}),
		getNextPageParam: (lastPage, _allPages, lastPageParam) =>
			getNextOffset(lastPage, lastPageParam),
	});
}
