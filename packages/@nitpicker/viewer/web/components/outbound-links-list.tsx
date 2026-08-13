import type { OutboundLink } from '@nitpicker/query';

import { useI18n } from '../i18n/use-i18n.js';

import { AppLink } from './app-link.js';

/** Hard cap on how many outbound links render before the list is truncated. */
export const MAX_LINKS_DISPLAYED = 200;

/** Props for {@link OutboundLinksList}. */
export interface OutboundLinksListProps {
	/** This page's outgoing links. */
	links: readonly OutboundLink[];
}

/**
 * Outbound-link list for the page-detail view, each entry linking to that
 * target's own detail page. Truncated at {@link MAX_LINKS_DISPLAYED} with a
 * note of how many entries were omitted — an unbounded page can have
 * thousands of outbound anchors.
 * @param props - The outbound links to render.
 * @returns The outbound-links section, or `null` when there are none.
 */
export function OutboundLinksList(props: OutboundLinksListProps) {
	const { t } = useI18n();
	const { links } = props;
	if (links.length === 0) {
		return null;
	}
	return (
		<>
			<h2>
				{t('views.pageDetail.outbound')} ({links.length})
			</h2>
			<ul>
				{links.slice(0, MAX_LINKS_DISPLAYED).map((link, index) => (
					<li key={`${link.url}-${index}`}>
						<AppLink to={`/pages/detail?url=${encodeURIComponent(link.url)}`}>
							{link.url}
						</AppLink>{' '}
						{link.status != null && <span className="state">[{link.status}]</span>}
					</li>
				))}
			</ul>
			{links.length > MAX_LINKS_DISPLAYED && (
				<p className="state">
					{t('views.pageDetail.linksTruncated', {
						max: MAX_LINKS_DISPLAYED,
						total: links.length,
					})}
				</p>
			)}
		</>
	);
}
