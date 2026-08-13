import type { MetadataFulfillment } from '@nitpicker/query';

import { clampRatio } from '../utils/clamp-ratio.js';
import { formatPercent } from '../utils/format-percent.js';

/** Metadata fulfillment fields with their display labels (technical SEO terms). */
const METADATA_LABELS: { key: keyof MetadataFulfillment; label: string }[] = [
	{ key: 'title', label: 'Title' },
	{ key: 'description', label: 'Description' },
	{ key: 'keywords', label: 'Keywords' },
	{ key: 'ogTitle', label: 'og:title' },
	{ key: 'ogDescription', label: 'og:description' },
	{ key: 'ogImage', label: 'og:image' },
];

/**
 * A labeled horizontal bar showing a 0–1 ratio. The fill width and the
 * label both derive from the same `clampRatio` + `formatPercent`
 * pipeline so the visual width and the printed percent cannot drift
 * apart. The earlier implementation called `Math.round(ratio * 100)`
 * in two places (once for the inline style, once for the label), so a
 * future refactor that touched one site without the other would have
 * produced an off-by-one mismatch between bar and label — funnelling
 * both sides through one transform keeps that whole class of bug out.
 * @param props - The bar label and ratio.
 * @param props.label - The bar label.
 * @param props.ratio - The ratio (0–1).
 */
function MetadataFulfillmentRow(props: { label: string; ratio: number }) {
	const clamped = clampRatio(props.ratio);
	return (
		<div className="bar-row">
			<span style={{ width: 110 }}>{props.label}</span>
			<span className="bar-track">
				<span className="bar-fill" style={{ width: `${clamped * 100}%` }} />
			</span>
			<span>{formatPercent(clamped)}</span>
		</div>
	);
}

/** Props for {@link MetadataFulfillmentBars}. */
export interface MetadataFulfillmentBarsProps {
	/** Fulfillment ratios (0–1) for each tracked metadata field. */
	fulfillment: MetadataFulfillment;
}

/**
 * The metadata-fulfillment section of the Summary view: one ratio bar per
 * tracked field (Title, Description, Keywords, og:title, og:description,
 * og:image).
 * @param props - The fulfillment ratios.
 * @returns The bar group element.
 */
export function MetadataFulfillmentBars(props: MetadataFulfillmentBarsProps) {
	return (
		<div className="bars">
			{METADATA_LABELS.map(({ key, label }) => (
				<MetadataFulfillmentRow key={key} label={label} ratio={props.fulfillment[key]} />
			))}
		</div>
	);
}
