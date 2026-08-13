import { useSummary } from '../api/use-summary.js';
import { ContentTypeStackedBar } from '../components/content-type-stacked-bar.js';
import { MetadataFulfillmentBars } from '../components/metadata-fulfillment-bars.js';
import { StatusDistributionBars } from '../components/status-distribution-bars.js';
import { SummaryCard } from '../components/summary-card.js';
import { TechnologyDistributionBars } from '../components/technology-distribution-bars.js';
import { ViewHeader } from '../components/view-header.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * The summary dashboard: page counts, status distribution, content-type
 * distribution, and metadata fulfillment for the opened archive.
 *
 * All three bar groups show **shares of the whole** (segment width
 * proportional to count / total) rather than shares of the largest bucket.
 * Status / metadata stay as individual rows; content-type collapses into a
 * single stacked bar plus legend so the user can read all categories at a
 * glance, the same way the macOS / iOS storage view does. All percent
 * labels go through {@link import('../utils/format-percent.js').formatPercent}
 * (inside each bar-group component below) so precision and the
 * sub-0.1%-but-non-zero edge case read consistently across groups.
 *
 * The status group can contain two 404 rows: the plain `404` row
 * (fix-target broken pages) and a trailing `404 (inventory-seed)` row
 * (input mistakes from a `crawl --inventory` list — see
 * `StatusCount.inventorySeed`). The card totals above never include 404s
 * of either kind, so the histogram is the only place they surface here.
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
			{/* Exclude settings, same <p> row style as roots above. Each row is
			    suppressed when its value is empty/zero — most archives crawl
			    without exclusions, so an always-shown block would be noise the
			    same way the console-log cards below are gated on non-zero. */}
			{[
				{ key: 'excludes', text: data.excludes.join(', ') || null },
				{ key: 'excludeKeywords', text: data.excludeKeywords.join(', ') || null },
				{ key: 'excludeUrls', text: data.excludeUrls.join(', ') || null },
				{
					key: 'maxExcludedDepth',
					text: data.maxExcludedDepth > 0 ? String(data.maxExcludedDepth) : null,
				},
			].map(
				(row) =>
					row.text !== null && (
						<p key={row.key} className="state">
							{t(`views.summary.${row.key}`)}: {row.text}
						</p>
					),
			)}
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
				<SummaryCard
					label={t('views.summary.internalContents')}
					value={data.internalContents}
				/>
				<SummaryCard
					label={t('views.summary.internalPages')}
					value={data.internalPages}
				/>
				<SummaryCard
					label={t('views.summary.externalContents')}
					value={data.externalContents}
				/>
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
						<SummaryCard
							label={t('views.summary.consolePageErrors')}
							value={data.consoleLogCounts.pageerror}
						/>
						<SummaryCard
							label={t('views.summary.consoleErrors')}
							value={data.consoleLogCounts.error}
						/>
						<SummaryCard
							label={t('views.summary.consoleWarnings')}
							value={data.consoleLogCounts.warn}
						/>
					</div>
				</>
			)}

			<h2>{t('views.summary.statusDistribution')}</h2>
			<StatusDistributionBars entries={data.statusDistribution} />

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
			<MetadataFulfillmentBars fulfillment={data.metadataFulfillment} />

			<TechnologyDistributionBars
				technologyDistribution={data.technologyDistribution}
				internalPages={data.internalPages}
			/>
		</div>
	);
}
