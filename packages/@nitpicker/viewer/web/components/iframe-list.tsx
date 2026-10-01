import type { MainContentIframeEntry } from '@nitpicker/query';

import { useI18n } from '../i18n/use-i18n.js';

import { ExternalUrl } from './external-url.js';

/** Props for {@link IframeList}. */
export interface IframeListProps {
	/** Iframes within the main region, in DOM order. */
	iframes: readonly MainContentIframeEntry[];
}

/**
 * Iframes found within a page's detected main-content region.
 * @param props - The iframe entries to render.
 * @returns The iframes section, or `null` when there are none.
 */
export function IframeList(props: IframeListProps) {
	const { t } = useI18n();
	const { iframes } = props;
	if (iframes.length === 0) {
		return null;
	}
	return (
		<>
			<h3>
				{t('views.pageDetail.mainContentIframes')} ({iframes.length})
			</h3>
			<ul className="detail-list">
				{iframes.map((iframe, index) => (
					<li key={index}>
						<ExternalUrl url={iframe.src} />
						{iframe.title ? ` (${iframe.title})` : ''}
					</li>
				))}
			</ul>
		</>
	);
}
