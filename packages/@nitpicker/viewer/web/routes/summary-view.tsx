import type { MetadataFulfillment } from '@nitpicker/query';

import { useSummary } from '../api/use-summary.js';
import { ViewHeader } from '../components/view-header.js';
import { useI18n } from '../i18n/use-i18n.js';

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
 * A labeled horizontal bar showing a 0–1 ratio.
 * @param props - The bar label and ratio.
 * @param props.label - The bar label.
 * @param props.ratio - The ratio (0–1).
 */
function RatioBar(props: { label: string; ratio: number }) {
	return (
		<div className="bar-row">
			<span style={{ width: 110 }}>{props.label}</span>
			<span className="bar-track">
				<span
					className="bar-fill"
					style={{ width: `${Math.round(props.ratio * 100)}%` }}
				/>
			</span>
			<span>{Math.round(props.ratio * 100)}%</span>
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

	const maxStatusCount = Math.max(1, ...data.statusDistribution.map((s) => s.count));
	const maxContentTypeCount = Math.max(
		1,
		...data.contentTypeDistribution.map((c) => c.internal + c.external),
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
				{data.statusDistribution.map((entry) => (
					<div key={entry.status ?? 'none'} className="bar-row">
						<span style={{ width: 60 }}>{entry.status ?? '—'}</span>
						<span className="bar-track">
							<span
								className="bar-fill"
								style={{ width: `${Math.round((entry.count / maxStatusCount) * 100)}%` }}
							/>
						</span>
						<span>{entry.count.toLocaleString()}</span>
					</div>
				))}
			</div>

			<h2>{t('views.summary.contentTypeDistribution')}</h2>
			<div className="bars">
				{data.contentTypeDistribution.map((entry) => {
					const total = entry.internal + entry.external;
					return (
						<div key={entry.category} className="bar-row">
							<span style={{ width: 160 }}>
								{t(`views.contentType.${entry.category}` as const)}
							</span>
							<span className="bar-track">
								<span
									className="bar-fill"
									style={{
										width: `${Math.round((total / maxContentTypeCount) * 100)}%`,
									}}
								/>
							</span>
							<span>
								{total.toLocaleString()}
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
						</div>
					);
				})}
			</div>

			<h2>{t('views.summary.metadataFulfillment')}</h2>
			<div className="bars">
				{METADATA_LABELS.map(({ key, label }) => (
					<RatioBar key={key} label={label} ratio={data.metadataFulfillment[key]} />
				))}
			</div>
		</div>
	);
}
