import type {
	HtmlReportData,
	HtmlReportPage,
	StaticTableColumn,
} from '../report-ui/types.js';

import { useI18n } from '../i18n/use-i18n.js';

import { ContentTypeStackedBar } from './content-type-stacked-bar.js';
import { MetadataFulfillmentBars } from './metadata-fulfillment-bars.js';
import { StaticTable } from './static-table.js';
import { StatusDistributionBars } from './status-distribution-bars.js';
import { SummaryCard } from './summary-card.js';
import { TechnologyDistributionBars } from './technology-distribution-bars.js';
import { toHttpHref } from './to-http-href.js';

/**
 * Renders a crawled URL as an http(s) link, or as plain text when the href
 * would not be safe to follow from a `file://` report.
 * @param url - The URL shown to the reader.
 * @param props
 * @param props.url
 */
function ReportUrl(props: { url: string }) {
	const href = toHttpHref(props.url);
	return href ? <a href={href}>{props.url}</a> : props.url;
}

/**
 * A data-only report document body that reuses the viewer summary components
 * and renders all supplied pages in their original order.
 * @param props - Fully prepared summary and page data.
 * @returns The static report body.
 * @example
 * ```tsx
 * <I18nProvider initialLocale="ja">
 *   <HtmlReportDocument summary={summary} pages={pages} />
 * </I18nProvider>
 * ```
 */
export function HtmlReportDocument(props: HtmlReportData) {
	const { t } = useI18n();
	const columns: readonly StaticTableColumn<HtmlReportPage>[] = [
		{
			key: 'title',
			label: t('views.report.columns.title'),
			render: (page) => page.title ?? t('common.none'),
		},
		{
			key: 'url',
			label: t('views.report.columns.url'),
			render: (page) => <ReportUrl url={page.url} />,
		},
		{
			key: 'status',
			label: t('views.report.columns.status'),
			render: (page) => page.status ?? t('common.none'),
		},
		{
			key: 'redirectChain',
			label: t('views.report.columns.redirectChain'),
			render: (page) =>
				page.redirectChain.length > 0
					? page.redirectChain.map((url, index) => (
							<span key={`${url}-${index}`}>
								{index > 0 && ' → '}
								<ReportUrl url={url} />
							</span>
						))
					: t('common.none'),
		},
		{
			key: 'metaDescription',
			label: t('views.report.columns.metaDescription'),
			render: (page) => page.metaDescription ?? t('common.none'),
		},
		{
			key: 'resourceFiles',
			label: t('views.report.columns.resourceFiles'),
			render: (page) => `${page.resourceFilesExists} / ${page.resourceFilesTotal}`,
		},
		{
			key: 'consoleErrorCount',
			label: t('views.report.columns.consoleErrorCount'),
			render: (page) => page.consoleErrorCount ?? t('common.none'),
		},
	];

	return (
		<div className="report-document">
			<header className="top-bar">
				<strong className="top-bar-title">
					{props.title ?? t('views.report.title')}
				</strong>
				<div className="top-bar-actions">
					<button
						type="button"
						className="icon-button"
						data-report-theme-toggle
						data-to-light={t('theme.toLight')}
						data-to-dark={t('theme.toDark')}
						aria-label={t('theme.toLight')}
						title={t('theme.toLight')}>
						☀
					</button>
				</div>
			</header>
			<main className="content report-content">
				<h1>{props.title ?? t('views.report.title')}</h1>
				<p className="view-description">{props.summary.baseUrl}</p>
				{props.generatedAt && (
					<p className="state">
						{t('views.report.generatedAt')}: {props.generatedAt}
					</p>
				)}
				{props.directoryPrefixes && props.directoryPrefixes.length > 0 && (
					<p className="view-description">
						{t('views.report.directoryFilter', {
							dirs: props.directoryPrefixes.join(', '),
						})}
					</p>
				)}

				<h2>{t('views.summary.title')}</h2>
				<div className="cards">
					<SummaryCard
						label={t('views.summary.internalContents')}
						value={props.summary.internalContents}
					/>
					<SummaryCard
						label={t('views.summary.internalPages')}
						value={props.summary.internalPages}
					/>
					<SummaryCard
						label={t('views.summary.externalContents')}
						value={props.summary.externalContents}
					/>
				</div>

				<h2>{t('views.summary.statusDistribution')}</h2>
				<StatusDistributionBars entries={props.summary.statusDistribution} />

				{props.summary.contentTypeDistribution.some(
					(entry) => entry.internal + entry.external > 0,
				) && (
					<>
						<h2>{t('views.summary.contentTypeDistribution')}</h2>
						<ContentTypeStackedBar entries={props.summary.contentTypeDistribution} />
					</>
				)}

				<h2>{t('views.summary.metadataFulfillment')}</h2>
				<MetadataFulfillmentBars fulfillment={props.summary.metadataFulfillment} />

				<TechnologyDistributionBars
					technologyDistribution={props.summary.technologyDistribution}
					internalPages={props.summary.internalPages}
					showViewAllLink={false}
				/>

				<h2>
					{t('views.report.pages')} ({props.pages.length.toLocaleString()})
				</h2>
				<StaticTable rows={props.pages} rowKey={(page) => page.url} columns={columns} />
			</main>
		</div>
	);
}
