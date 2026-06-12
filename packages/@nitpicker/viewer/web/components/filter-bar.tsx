import type { ReactNode } from 'react';

/** Props for {@link FilterBar}. */
export interface FilterBarProps {
	/** The filter controls to render. */
	children: ReactNode;
}

/**
 * A horizontal container for a view's filter/sort controls.
 * @param props - The filter controls.
 * @returns The filter bar element.
 */
export function FilterBar(props: FilterBarProps) {
	return <div className="filter-bar">{props.children}</div>;
}
