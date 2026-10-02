import type { ReactNode } from 'react';

/** One labelled value in a {@link PropertyList}. */
export interface PropertyListItem {
	/** The property's name, shown dimmed above its value. */
	label: string;
	/** The property's value, shown prominently. */
	value: ReactNode;
}

/** Props for {@link PropertyList}. */
export interface PropertyListProps {
	/** The properties, in display order. */
	items: readonly PropertyListItem[];
}

/**
 * A compact row of labelled properties (`<dl>`), each as a small label over a
 * prominent value — the card-header counterpart of `.detail-grid`, for the
 * two or three facts that identify a heading's subject at a glance (page
 * count, related paths, ...). Longer or optional detail belongs in a
 * `<details>` beneath, not here.
 * @param props - The properties to show.
 * @returns The `<dl>` element.
 * @example
 * <PropertyList
 *   items={[
 *     { label: 'Pages', value: 12 },
 *     { label: 'Clusters', value: 3 },
 *   ]}
 * />
 */
export function PropertyList(props: PropertyListProps) {
	return (
		<dl className="property-list">
			{props.items.map((item) => (
				<div key={item.label} className="property-list-item">
					<dt>{item.label}</dt>
					<dd>{item.value}</dd>
				</div>
			))}
		</dl>
	);
}
