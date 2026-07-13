import { Link, useSearchParams } from 'react-router';

import { usePageDetail } from '../api/use-page-detail.js';
import { usePageHtml } from '../api/use-page-html.js';
import { HtmlPreview } from '../components/html-preview.js';
import { ViewHeader } from '../components/view-header.js';
import { useI18n } from '../i18n/use-i18n.js';

const MAX_LINKS_DISPLAYED = 200;

/**
 * Full detail for a single page: metadata, inbound/outbound links, redirects,
 * and the stored HTML snapshot. The target URL comes from the `url` query param.
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
			<Link to="/pages">
				{t('common.back')} {t('nav.pages')}
			</Link>
			<dl className="detail-grid">
				<dt>URL</dt>
				<dd>{data.url}</dd>
				{data.isSkipped && (
					<>
						<dt>{t('views.pageDetail.skipReason')}</dt>
						<dd>{data.skipReason ?? '—'}</dd>
					</>
				)}
				<dt>{t('views.pageDetail.status')}</dt>
				<dd>
					{data.status ?? '—'} {data.statusText ?? ''}
				</dd>
				<dt>{t('views.pageDetail.contentType')}</dt>
				<dd>{data.contentType ?? '—'}</dd>
				<dt>{t('views.pageDetail.title2')}</dt>
				<dd>{data.title ?? '—'}</dd>
				<dt>lang</dt>
				<dd>{data.lang ?? '—'}</dd>
				<dt>{t('views.pageDetail.descriptionField')}</dt>
				<dd>{data.description ?? '—'}</dd>
				<dt>{t('views.pageDetail.canonical')}</dt>
				<dd>{data.canonical ?? '—'}</dd>
				<dt>{t('views.pageDetail.robots')}</dt>
				<dd>
					{[
						data.noindex && 'noindex',
						data.nofollow && 'nofollow',
						data.noarchive && 'noarchive',
						data.noimageindex && 'noimageindex',
					]
						.filter(Boolean)
						.join(', ') || '—'}
				</dd>
				{data.robotsRaw && (
					<>
						<dt>robots:raw</dt>
						<dd>{data.robotsRaw}</dd>
					</>
				)}
				<dt>{t('views.pageDetail.ogTitle')}</dt>
				<dd>{data.ogTitle ?? '—'}</dd>
				<dt>{t('views.pageDetail.ogImage')}</dt>
				<dd>{data.ogImage ?? '—'}</dd>
				{data.ogImageAlt && (
					<>
						<dt>og:image:alt</dt>
						<dd>{data.ogImageAlt}</dd>
					</>
				)}
				{data.ogLocale && (
					<>
						<dt>og:locale</dt>
						<dd>{data.ogLocale}</dd>
					</>
				)}
				{data.ogArticlePublishedTime && (
					<>
						<dt>og:article:published_time</dt>
						<dd>{data.ogArticlePublishedTime}</dd>
					</>
				)}
				{(data.twitterSite || data.twitterCreator) && (
					<>
						<dt>twitter:site / creator</dt>
						<dd>
							{[data.twitterSite, data.twitterCreator].filter(Boolean).join(' / ') || '—'}
						</dd>
					</>
				)}
				{data.charset && (
					<>
						<dt>charset</dt>
						<dd>{data.charset}</dd>
					</>
				)}
				{data.manifest && (
					<>
						<dt>manifest</dt>
						<dd>{data.manifest}</dd>
					</>
				)}
				{data.themeColor && (
					<>
						<dt>theme-color</dt>
						<dd>{data.themeColor}</dd>
					</>
				)}
				{(data.tagCount ?? 0) > 0 && (
					<>
						<dt>Wappalyzer tags</dt>
						<dd>
							{data.tagCount} entries
							{data.tagsProvidersCsv ? ` (${data.tagsProvidersCsv})` : ''}
						</dd>
					</>
				)}
				{(data.jsonldCount ?? 0) > 0 && (
					<>
						<dt>JSON-LD</dt>
						<dd>
							{data.jsonldCount} entries
							{data.jsonLd.types.length > 0 ? ` [${data.jsonLd.types.join(', ')}]` : ''}
						</dd>
					</>
				)}
			</dl>

			<h2>
				{t('views.pageDetail.inbound')} ({data.inboundLinks.length})
			</h2>
			<ul>
				{data.inboundLinks.slice(0, MAX_LINKS_DISPLAYED).map((link, index) => (
					<li key={`${link.url}-${index}`}>
						<Link to={`/pages/detail?url=${encodeURIComponent(link.url)}`}>
							{link.url}
						</Link>
					</li>
				))}
			</ul>
			{data.inboundLinks.length > MAX_LINKS_DISPLAYED && (
				<p className="state">
					{t('views.pageDetail.linksTruncated', {
						max: MAX_LINKS_DISPLAYED,
						total: data.inboundLinks.length,
					})}
				</p>
			)}

			{data.outboundLinks.length > 0 && (
				<>
					<h2>
						{t('views.pageDetail.outbound')} ({data.outboundLinks.length})
					</h2>
					<ul>
						{data.outboundLinks.slice(0, MAX_LINKS_DISPLAYED).map((link, index) => (
							<li key={`${link.url}-${index}`}>
								<Link to={`/pages/detail?url=${encodeURIComponent(link.url)}`}>
									{link.url}
								</Link>{' '}
								{link.status != null && <span className="state">[{link.status}]</span>}
							</li>
						))}
					</ul>
					{data.outboundLinks.length > MAX_LINKS_DISPLAYED && (
						<p className="state">
							{t('views.pageDetail.linksTruncated', {
								max: MAX_LINKS_DISPLAYED,
								total: data.outboundLinks.length,
							})}
						</p>
					)}
				</>
			)}

			{data.redirectFrom.length > 0 && (
				<>
					<h2>
						{t('views.pageDetail.redirectedFrom')} ({data.redirectFrom.length})
					</h2>
					<ul>
						{data.redirectFrom.map((from) => (
							<li key={from}>{from}</li>
						))}
					</ul>
				</>
			)}

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
