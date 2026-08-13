/** Props for {@link SummaryCard}. */
export interface SummaryCardProps {
	/** The card's label. */
	label: string;
	/** The card's numeric value. */
	value: number;
}

/**
 * A single statistic card: a label over a large, locale-formatted number.
 * @param props - The card label and numeric value.
 * @returns The card element.
 */
export function SummaryCard(props: SummaryCardProps) {
	return (
		<div className="card">
			<div className="card-label">{props.label}</div>
			<div className="card-value">{props.value.toLocaleString()}</div>
		</div>
	);
}
