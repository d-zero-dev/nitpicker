import type { TechnologyCount } from '@nitpicker/query';

import { useI18n } from '../i18n/use-i18n.js';
import { clampRatio } from '../utils/clamp-ratio.js';
import { computeRatio } from '../utils/compute-ratio.js';
import { formatPercent } from '../utils/format-percent.js';

import { AppLink } from './app-link.js';

/** Cap on rows shown in the summary's technology stack section — the full list lives at `/technologies`. */
const MAX_TECHNOLOGIES_DISPLAYED = 10;

/**
 * A labeled horizontal bar showing a 0–1 ratio, same shape as
 * `MetadataFulfillmentBars`' internal row (each bar-group component owns
 * its own private row renderer rather than sharing one).
 * @param props - The bar label and ratio.
 * @param props.label - The bar label.
 * @param props.ratio - The ratio (0–1).
 */
function TechnologyRow(props: { label: string; ratio: number }) {
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

/** Props for {@link TechnologyDistributionBars}. */
export interface TechnologyDistributionBarsProps {
	/** Site-wide technology distribution, page count descending. */
	technologyDistribution: readonly TechnologyCount[];
	/** Total internal pages — the ratio denominator for each bar. */
	internalPages: number;
	/** Whether to render the viewer-only link to the full technology view. */
	showViewAllLink?: boolean;
}

/**
 * The Summary view's technology-stack section: the top
 * {@link MAX_TECHNOLOGIES_DISPLAYED} detected technologies as ratio bars
 * (share of internal pages), with a link to the full `/technologies` view.
 * Renders nothing when no technology was detected.
 * @param props - The distribution and its ratio denominator.
 * @returns The section element, or `null` when there is nothing to show.
 */
export function TechnologyDistributionBars(props: TechnologyDistributionBarsProps) {
	const { t } = useI18n();
	const { technologyDistribution, internalPages } = props;
	if (technologyDistribution.length === 0) {
		return null;
	}
	return (
		<>
			<h2>{t('views.summary.technologyDistribution')}</h2>
			<div className="bars">
				{technologyDistribution.slice(0, MAX_TECHNOLOGIES_DISPLAYED).map((entry) => (
					<TechnologyRow
						key={entry.technology}
						label={entry.technology}
						ratio={computeRatio(entry.pageCount, internalPages)}
					/>
				))}
			</div>
			{props.showViewAllLink !== false && (
				<AppLink to="/technologies">{t('views.summary.viewAllTechnologies')}</AppLink>
			)}
		</>
	);
}
