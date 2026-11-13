import type { ReactNode } from 'react';

import { applyFilterUpdates } from '../hooks/apply-filter-updates.js';
import { useUrlFilter } from '../hooks/use-url-filter.js';

import { AppLink } from './app-link.js';

/** Props for {@link FilterLink}. */
export interface FilterLinkProps {
	/** The `[key, value]` query updates the link applies, as {@link applyFilterUpdates} takes them. */
	updates: ReadonlyArray<readonly [key: string, value: string | readonly string[]]>;
	/** Class name for the anchor. */
	className?: string;
	/** The link content. */
	children: ReactNode;
}

/**
 * A link to the current page with query updates applied (a master → detail
 * drill-in, a "back" to the list), built with the same rules the in-place
 * updater (`useUrlFilter().updateMany`) uses: other filters stay and `?page=`
 * resets when a filter changes. It reads the current query itself, so a table
 * cell can render it without the column definitions depending on the query.
 * @param props - The updates, class name and content.
 * @returns The link element.
 * @example
 * ```tsx
 * <FilterLink className="link-button" updates={[['cluster', url]]}>
 *   {url}
 * </FilterLink>
 * ```
 */
export function FilterLink(props: FilterLinkProps) {
	const { params } = useUrlFilter();
	return (
		<AppLink
			className={props.className}
			to={{ search: applyFilterUpdates(params, props.updates).toString() }}>
			{props.children}
		</AppLink>
	);
}
