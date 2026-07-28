import type { MetadataFulfillment } from '@nitpicker/query';

import { useSummary } from '../api/use-summary.js';
import { ContentTypeStackedBar } from '../components/content-type-stacked-bar.js';
import { ViewHeader } from '../components/view-header.js';
import { getAttributionLabel } from '../i18n/get-attribution-label.js';
import { getErrorKindLabel } from '../i18n/get-error-kind-label.js';
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
			{data.networkOutageAffectedFailures > 0 && (
				<p className="filter-notice">
					{t('views.summary.networkOutageNotice', {
						count: data.networkOutageAffectedFailures,
					})}
				</p>
			)}
			{data.roots.map((root) => (
				<p key={root} className="state">
					{root}
				</p>
			))}
			{/* Three cards (was four). "Roots" is dropped because the root URL
			    list is already rendered above as `<p>` rows — a count card is
			    redundant. The remaining three give the user the three numbers
			    they actually need at a glance:
			    - Internal contents: every in-scope URL the crawl reached
			      (HTML + PDF + CSV + ZIP + ...). This is the "how much stuff
			      is under your domains" number.
			    - Internal pages: just the HTML pages — what was rendered + had
			      metadata extracted. Always ≤ internalContents.
			    - External contents: every outbound link found (any MIME). */}
			<div className="cards">
				<Card label={t('views.summary.internalContents')} value={data.internalContents} />
				<Card label={t('views.summary.internalPages')} value={data.internalPages} />
				<Card label={t('views.summary.externalContents')} value={data.externalContents} />
			</div>

			{/* Suppressed when zero — most archives have zero page errors and
			    warnings, so an all-zero section every time would be noise
			    the same way the content-type bar suppresses on zero. */}
			{(data.consoleLogCounts.pageerror > 0 ||
				data.consoleLogCounts.error > 0 ||
				data.consoleLogCounts.warn > 0) && (
				<>
					<h2>{t('views.summary.consoleLogs')}</h2>
					<div className="cards">
						<Card
							label={t('views.summary.consolePageErrors')}
							value={data.consoleLogCounts.pageerror}
						/>
						<Card
							label={t('views.summary.consoleErrors')}
							value={data.consoleLogCounts.error}
						/>
						<Card
							label={t('views.summary.consoleWarnings')}
							value={data.consoleLogCounts.warn}
						/>
					</div>
				</>
			)}

			<h2>{t('views.summary.statusDistribution')}</h2>
			<div className="bars">
				{data.statusDistribution.map((entry) => {
					const ratio = computeRatio(entry.count, statusTotal);
					const showBreakdown =
						entry.status === -1 &&
						entry.errorKindBreakdown !== undefined &&
						entry.errorKindBreakdown.length > 0;
					return (
						<div
							key={entry.status ?? 'none'}
							role={showBreakdown ? 'group' : undefined}
							aria-label={
								showBreakdown
									? t('views.summary.statusBreakdownAria', {
											count: entry.count,
										})
									: undefined
							}>
							<div className="bar-row">
								<span style={{ width: 60 }}>{entry.status ?? '—'}</span>
								<span className="bar-track">
									<span className="bar-fill" style={{ width: `${ratio * 100}%` }} />
								</span>
								<span>
									{entry.count.toLocaleString()} <small>({formatPercent(ratio)})</small>
								</span>
							</div>
							{showBreakdown && entry.errorKindBreakdown && (
								<ul
									style={{
										listStyle: 'none',
										paddingLeft: 24,
										margin: 0,
										fontSize: '0.8em',
									}}>
									{entry.errorKindBreakdown.map((sub) => {
										// Denominator is the parent -1 count so the sub-bars
										// describe the composition of -1, not the global mix.
										const subRatio = computeRatio(sub.count, entry.count);
										// Keyed on kind+attribution, not kind alone: the same
										// kind (e.g. 'dns') can appear twice — once site-caused,
										// once network-caused (outage-attributed) — and both
										// rows must render, not collide/overwrite in React's
										// reconciliation.
										return (
											<li key={`${sub.kind}-${sub.attribution}`} className="bar-row">
												<span style={{ width: 110 }}>
													{getErrorKindLabel(sub.kind, t)}
													{/* Only the network-caused rows get an extra
													    label — the site-caused case is the
													    pre-existing, unsurprising default and stays
													    visually unchanged. */}
													{sub.attribution === 'network' && (
														<>
															{' · '}
															<small>{getAttributionLabel(sub.attribution, t)}</small>
														</>
													)}
												</span>
												<span className="bar-track">
													<span
														className="bar-fill"
														style={{ width: `${subRatio * 100}%` }}
													/>
												</span>
												<span>
													{sub.count.toLocaleString()}{' '}
													<small>({formatPercent(subRatio)})</small>
												</span>
											</li>
										);
									})}
								</ul>
							)}
						</div>
					);
				})}
			</div>

			{/* Suppress the whole section when the bar would render nothing.
			    `ContentTypeStackedBar` returns null on zero in-scope rows;
			    leaving the heading visible alone reads as a render glitch
			    on pristine / very-early-interrupted archives. */}
			{data.contentTypeDistribution.some(
				(entry) => entry.internal + entry.external > 0,
			) && (
				<>
					<h2>{t('views.summary.contentTypeDistribution')}</h2>
					<ContentTypeStackedBar entries={data.contentTypeDistribution} />
				</>
			)}

			<h2>{t('views.summary.metadataFulfillment')}</h2>
			<div className="bars">
				{METADATA_LABELS.map(({ key, label }) => (
					<RatioBar key={key} label={label} ratio={data.metadataFulfillment[key]} />
				))}
			</div>
		</div>
	);
}
