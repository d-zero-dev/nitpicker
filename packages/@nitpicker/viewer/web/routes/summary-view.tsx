import type { MetadataFulfillment } from '@nitpicker/query';

import { useSummary } from '../api/use-summary.js';
import { ContentTypeStackedBar } from '../components/content-type-stacked-bar.js';
import { ViewHeader } from '../components/view-header.js';
import { useI18n } from '../i18n/use-i18n.js';
import { clampRatio } from '../utils/clamp-ratio.js';
import { computeRatio } from '../utils/compute-ratio.js';
import { formatPercent } from '../utils/format-percent.js';

/**
 * A single statistic card.
 * @param props - The card label and numeric value.
 * @param props.label - The card label.
 * @param props.value - The numeric value.
 */
function Card(props: { label: string; value: number }) {
	return (
		<div className="card">
			<div className="card-label">{props.label}</div>
			<div className="card-value">{props.value.toLocaleString()}</div>
		</div>
	);
}

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
function RatioBar(props: { label: string; ratio: number }) {
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
 * The summary dashboard: page counts, status distribution, content-type
 * distribution, and metadata fulfillment for the opened archive.
 *
 * All three bar groups now show **shares of the whole** (segment width
 * proportional to count / total) rather than shares of the largest bucket.
 * Status / metadata stay as individual rows; content-type collapses into a
 * single stacked bar plus legend so the user can read all categories at a
 * glance, the same way the macOS / iOS storage view does. All percent
 * labels go through {@link formatPercent} so precision and the
 * sub-0.1%-but-non-zero edge case read consistently across groups.
 * @returns The summary view element.
 */
export function SummaryView() {
	const { t } = useI18n();
	const { data, isLoading, error } = useSummary();

	if (isLoading) {
		return <div className="state">{t('common.loading')}</div>;
	}
	if (error) {
		return <div className="state state-error">{error.message}</div>;
	}
	if (!data) {
		return null;
	}

	const statusTotal = data.statusDistribution.reduce(
		(acc, entry) => acc + entry.count,
		0,
	);

	return (
		<div>
			<ViewHeader
				titleKey="views.summary.title"
				descriptionKey="views.summary.description"
			/>
			{data.roots.map((root) => (
				<p key={root} className="state">
					{root}
				</p>
			))}
			<div className="cards">
				<Card label={t('views.summary.totalPages')} value={data.totalPages} />
				<Card label={t('views.summary.internalPages')} value={data.internalPages} />
				<Card label={t('views.summary.externalPages')} value={data.externalPages} />
				<Card label={t('views.summary.roots')} value={data.roots.length} />
			</div>

			<h2>{t('views.summary.statusDistribution')}</h2>
			<div className="bars">
				{data.statusDistribution.map((entry) => {
					const ratio = computeRatio(entry.count, statusTotal);
					return (
						<div key={entry.status ?? 'none'} className="bar-row">
							<span style={{ width: 60 }}>{entry.status ?? '—'}</span>
							<span className="bar-track">
								<span className="bar-fill" style={{ width: `${ratio * 100}%` }} />
							</span>
							<span>
								{entry.count.toLocaleString()} <small>({formatPercent(ratio)})</small>
							</span>
						</div>
					);
				})}
			</div>

			<h2>{t('views.summary.contentTypeDistribution')}</h2>
			<ContentTypeStackedBar entries={data.contentTypeDistribution} />

			<h2>{t('views.summary.metadataFulfillment')}</h2>
			<div className="bars">
				{METADATA_LABELS.map(({ key, label }) => (
					<RatioBar key={key} label={label} ratio={data.metadataFulfillment[key]} />
				))}
			</div>
		</div>
	);
}
