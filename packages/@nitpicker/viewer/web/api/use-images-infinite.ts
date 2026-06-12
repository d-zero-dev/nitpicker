import type { PaginatedImageList } from '@nitpicker/query';

import { useInfiniteQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';
import { getNextOffset } from './get-next-offset.js';
import { PAGE_SIZE } from './page-size.js';

/** Filter state for the images view. */
export interface ImagesFilter {
	/** Filter to images missing alt text. */
	missingAlt?: boolean;
	/** Filter to images missing explicit dimensions. */
	missingDimensions?: boolean;
	/** Filter to images whose intrinsic size exceeds this threshold. */
	oversizedThreshold?: number;
	/** URL pattern to filter source URLs. */
	urlPattern?: string;
}

/**
 * Infinite-scrolling image list.
 * @param filter - The active filter state.
 * @returns The TanStack infinite-query result.
 */
export function useImagesInfinite(filter: ImagesFilter) {
	return useInfiniteQuery({
		queryKey: ['images', filter],
		initialPageParam: 0,
		queryFn: ({ pageParam }) =>
			apiGet<PaginatedImageList>('/api/images', {
				...filter,
				limit: PAGE_SIZE,
				offset: pageParam,
			}),
		getNextPageParam: (lastPage, _allPages, lastPageParam) =>
			getNextOffset(lastPage, lastPageParam),
	});
}
