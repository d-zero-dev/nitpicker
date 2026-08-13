import { useSearchParams } from 'react-router';

import { useInboundLinks } from '../api/use-inbound-links.js';
import { usePageDetail } from '../api/use-page-detail.js';
import { usePageHtml } from '../api/use-page-html.js';
import { usePageMainContents } from '../api/use-page-main-contents.js';
import { usePageTechnologies } from '../api/use-page-technologies.js';
import { AppLink } from '../components/app-link.js';
import { AudioList } from '../components/audio-list.js';
import { ButtonList } from '../components/button-list.js';
import { CanvasList } from '../components/canvas-list.js';
import { ConsoleLogsList } from '../components/console-logs-list.js';
import { CustomElementList } from '../components/custom-element-list.js';
import { HeadingList } from '../components/heading-list.js';
import { HtmlPreview } from '../components/html-preview.js';
import { IframeList } from '../components/iframe-list.js';
import { ImageList } from '../components/image-list.js';
import { InboundLinksSummary } from '../components/inbound-links-summary.js';
import { MainContentSummary } from '../components/main-content-summary.js';
import { OutboundLinksList } from '../components/outbound-links-list.js';
import { PageMetadataGrid } from '../components/page-metadata-grid.js';
import { RedirectFromList } from '../components/redirect-from-list.js';
import { TableList } from '../components/table-list.js';
import { TechnologyStarChart } from '../components/technology-star-chart.js';
import { VideoList } from '../components/video-list.js';
import { ViewHeader } from '../components/view-header.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * Full detail for a single page: metadata, outbound links, redirects, and
 * the stored HTML snapshot. Inbound links are summarized by count with a
 * link to the dedicated `/pages/inbound-links` list (issue #235) — a page's
 * referrer count can reach the hundreds of thousands on a large site, too
 * large to embed here. The target URL comes from the `url` query param.
 * @returns The page detail view element.
 */
export function PageDetailView() {
	const [params] = useSearchParams();
	const { t } = useI18n();
	const url = params.get('url') ?? '';
	const { data, isLoading, error } = usePageDetail(url);
	// External pages are (normally) never scraped, so they never have a stored
	// HTML snapshot — skip the fetch entirely instead of always resolving to
	// "no snapshot". Gate on `data` being loaded (not just `!data?.isExternal`)
	// so the fetch isn't fired speculatively during the loading window, when
	// `data` is still undefined and its eventual `isExternal` value is unknown.
	const html = usePageHtml(data && !data.isExternal ? url : '');
	const mainContents = usePageMainContents(data && !data.isExternal ? url : '');
	const technologies = usePageTechnologies(url);
	// Count-only read (`limit: 0`) — the full inbound-link window lives at
	// `/pages/inbound-links`, not here (see this component's docs).
	const {
		data: inboundData,
		isLoading: inboundIsLoading,
		isError: inboundIsError,
		error: inboundError,
	} = useInboundLinks(url, { limit: 0 }, ['inbound-links-count', url], {
		enabled: url !== '',
	});
	const inboundUnavailable = inboundData != null && 'available' in inboundData;
	const inboundTotal =
		inboundData && !('available' in inboundData) ? inboundData.total : null;

	if (!url) {
		return <div className="state">{t('views.pageDetail.noPage')}</div>;
	}
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
				titleKey="views.pageDetail.title"
				descriptionKey="views.pageDetail.description"
			/>
			<AppLink to="/pages">
				{t('common.back')} {t('nav.pages')}
			</AppLink>
			<PageMetadataGrid data={data} />

			<InboundLinksSummary
				url={url}
				total={inboundTotal}
				isLoading={inboundIsLoading}
				isUnavailable={inboundUnavailable}
				errorMessage={inboundIsError ? inboundError.message : null}
			/>

			<OutboundLinksList links={data.outboundLinks} />

			<RedirectFromList urls={data.redirectFrom} />

			<ConsoleLogsList entries={data.consoleLogs} />

			{!data.isExternal && (
				<>
					<h2>{t('views.pageDetail.mainContent')}</h2>
					{mainContents.isLoading && (
						<div className="state">{t('views.pageDetail.loadingMainContent')}</div>
					)}
					{mainContents.data ? (
						<>
							<MainContentSummary
								selector={mainContents.data.main?.selector ?? null}
								wordCount={mainContents.data.wordCount}
								bodyWordCount={mainContents.data.bodyWordCount}
								scrollHeight={mainContents.data.scrollHeight}
							/>
							<HeadingList headings={mainContents.data.headings} />
							<ImageList images={mainContents.data.images} />
							<TableList tables={mainContents.data.tables} />
							<ButtonList buttons={mainContents.data.buttons} />
							<IframeList iframes={mainContents.data.iframes} />
							<VideoList videos={mainContents.data.videos} />
							<AudioList audios={mainContents.data.audios} />
							<CanvasList canvases={mainContents.data.canvases} />
							<CustomElementList customElements={mainContents.data.customElements} />
						</>
					) : (
						!mainContents.isLoading && (
							<div className="state">{t('views.pageDetail.noMainContent')}</div>
						)
					)}
				</>
			)}

			<TechnologyStarChart
				data={technologies.data}
				isLoading={technologies.isLoading}
				error={technologies.error}
			/>

			{/*
			 * Known limitation: gating on `isExternal` (rather than "does a
			 * snapshot actually exist") means a page reclassified external after
			 * having been scraped under an old scope, or migrated via
			 * `scripts/migrate-to-0.10.mjs`'s Step A (which copies every
			 * non-empty legacy `pages.html` row into the BLOB store regardless of
			 * `isExternal`), can have a real stored snapshot that this section
			 * never fetches or shows. Accepted for 0.x: the common case (an
			 * external page has no snapshot) is overwhelmingly more frequent than
			 * this edge case, and avoiding a wasted fetch for the common case is
			 * the point of this gate.
			 */}
			{!data.isExternal && (
				<>
					<h2>{t('views.pageDetail.htmlSnapshot')}</h2>
					{html.isLoading && (
						<div className="state">{t('views.pageDetail.loadingSnapshot')}</div>
					)}
					{html.data ? (
						<HtmlPreview html={html.data.html} truncated={html.data.truncated} />
					) : (
						!html.isLoading && (
							<div className="state">{t('views.pageDetail.noSnapshot')}</div>
						)
					)}
				</>
			)}
		</div>
	);
}
