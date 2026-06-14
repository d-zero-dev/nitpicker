import type { VisibleEntry } from './build-stacked-bar-entries.js';
import type { ContentTypeCount } from '@nitpicker/query';

import { useI18n } from '../i18n/use-i18n.js';
import { formatPercent } from '../utils/format-percent.js';

import { buildStackedBarRows } from './build-stacked-bar-rows.js';
import { contentTypeBarClass } from './content-type-class.js';

/**
 * One row in the stacked-bar legend: color/pattern swatch + label + count +
 * share, with an optional internal/external split when external pages exist.
 *
 * Internal to the stacked-bar file because it has no other call sites and
 * no shared state worth threading; lives here per the "1 export per file +
 * file-local helpers OK" rule.
 * @param props - The legend row data.
 * @param props.entry - The visible entry (category, total, internal/external split).
 * @param props.ratio - The pre-computed share of `grandTotal` for this row (0–1).
 * @returns The legend row element.
 */
function LegendRow(props: { entry: VisibleEntry; ratio: number }) {
	const { t } = useI18n();
	const { entry, ratio } = props;
	return (
		<li className="stacked-bar-legend-item">
			<span
				className={`${contentTypeBarClass(entry.category)} stacked-bar-swatch`}
				aria-hidden="true"
			/>
			<span className="stacked-bar-legend-label">
				{t(`views.contentType.${entry.category}` as const)}
			</span>
			<span className="stacked-bar-legend-count">
				{entry.total.toLocaleString()}{' '}
				<small className="stacked-bar-legend-percent">({formatPercent(ratio)})</small>
				{entry.external > 0 && (
					<>
						{' '}
						<small>
							({t('common.internal')} {entry.internal.toLocaleString()} /{' '}
							{t('common.external')} {entry.external.toLocaleString()})
						</small>
					</>
				)}
			</span>
		</li>
	);
}

/**
 * A horizontally stacked bar showing every non-zero content-type category's
 * share of the total, followed by a legend with per-category counts and
 * shares.
 *
 * Modelled on the macOS / iOS storage breakdown. Each segment carries both
 * a fill color and a pattern overlay (defined in `styles.css` via
 * `.bar-segment-<category>` rules), so categories remain distinguishable
 * under color-vision deficiencies without a separate accessibility toggle.
 *
 * All data shaping happens in {@link buildStackedBarRows} (pure, fully
 * unit-tested) — this component only walks the result list. Sub-pixel
 * segments are lifted by CSS (`.bar-segment { min-inline-size: 4px; }`)
 * rather than in JS, so the legend percentage stays the true raw share.
 * @param props - The bar inputs.
 * @param props.entries - Per-category counts (from `SummaryResult.contentTypeDistribution`).
 * @returns The stacked-bar + legend element, or `null` when the data is empty.
 */
export function ContentTypeStackedBar(props: { entries: readonly ContentTypeCount[] }) {
	const { t } = useI18n();
	const rows = buildStackedBarRows(props.entries);

	if (rows.length === 0) {
		return null;
	}

	return (
		<div className="stacked-bar-wrap">
			<div
				className="stacked-bar"
				role="img"
				aria-label={t('views.summary.contentTypeStackedBarLabel')}>
				{rows.map((row) => (
					<span
						key={row.entry.category}
						className={contentTypeBarClass(row.entry.category)}
						style={{ width: `${row.width}%` }}
						title={`${t(`views.contentType.${row.entry.category}` as const)}: ${row.entry.total.toLocaleString()} (${formatPercent(row.ratio)})`}
					/>
				))}
			</div>
			<ul className="stacked-bar-legend">
				{rows.map((row) => (
					<LegendRow key={row.entry.category} entry={row.entry} ratio={row.ratio} />
				))}
			</ul>
		</div>
	);
}
