import { useI18n } from '../i18n/use-i18n.js';

import { AppLink } from './app-link.js';

/** Props for {@link InboundLinksSummary}. */
export interface InboundLinksSummaryProps {
	/** The target page's URL — used to build the "view all" link. */
	url: string;
	/** Total inbound-link count, or `null` while unknown. */
	total: number | null;
	/** Whether the count-only inbound-links query is still loading. */
	isLoading: boolean;
	/** Whether inbound-link data is unavailable on this archive. */
	isUnavailable: boolean;
	/** The inbound-links query's error message, or `null` when it succeeded. */
	errorMessage: string | null;
}

/**
 * Inbound-link count summary for the page-detail view, with a link to the
 * full `/pages/inbound-links` list when there is at least one referrer. A
 * page's referrer count can reach the hundreds of thousands on a large
 * site, too large to embed here — see `PageDetailView`'s docs.
 * @param props - The inbound-link count and query status.
 * @returns The inbound-links summary section.
 */
export function InboundLinksSummary(props: InboundLinksSummaryProps) {
	const { t } = useI18n();
	const { url, total, isLoading, isUnavailable, errorMessage } = props;
	return (
		<>
			<h2>
				{t('views.pageDetail.inbound')}
				{total == null ? '' : ` (${total})`}
			</h2>
			{isUnavailable ? (
				<p className="state">{t('views.inboundLinks.unavailable')}</p>
			) : errorMessage == null ? (
				isLoading ? (
					<p className="state">{t('common.loading')}</p>
				) : (
					total != null &&
					total > 0 && (
						<AppLink to={`/pages/inbound-links?url=${encodeURIComponent(url)}`}>
							{t('views.pageDetail.viewInboundLinks')}
						</AppLink>
					)
				)
			) : (
				<p className="state state-error">{errorMessage}</p>
			)}
		</>
	);
}
