import type { PageDetail } from '@nitpicker/query';

import { useI18n } from '../i18n/use-i18n.js';

import { AppLink } from './app-link.js';

/** Props for {@link PageMetadataGrid}. */
export interface PageMetadataGridProps {
	/** The full page detail record — this component renders most of its fields. */
	data: PageDetail;
}

/**
 * Primary metadata grid for the page-detail view: URL, HTTP status,
 * meta/OpenGraph/Twitter tags, robots directives, and dedupe-cap/skip
 * status. Unlike the other page-detail sections (which each project one
 * narrow slice), this one renders the bulk of `PageDetail`'s ~25 fields, so
 * it takes the whole record rather than a per-field prop list.
 * @param props - The page detail to render.
 * @returns The metadata `<dl>` element.
 */
export function PageMetadataGrid(props: PageMetadataGridProps) {
	const { t } = useI18n();
	const { data } = props;
	return (
		<dl className="detail-grid">
			<dt>URL</dt>
			<dd>{data.url}</dd>
			{data.isSkipped && (
				<>
					<dt>{t('views.pageDetail.skipReason')}</dt>
					<dd>{data.skipReason ?? '—'}</dd>
				</>
			)}
			{data.isDedupeCapped && (
				<>
					<dt>{t('views.pageDetail.dedupeCapShapeKey')}</dt>
					<dd>
						{data.dedupeCapEventId == null ? (
							(data.dedupeCapShapeKey ?? '—')
						) : (
							<AppLink to={`/crawl-suppression#event-${data.dedupeCapEventId}`}>
								{data.dedupeCapShapeKey ?? '—'}
							</AppLink>
						)}
					</dd>
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
	);
}
