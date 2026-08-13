import { useI18n } from '../i18n/use-i18n.js';

/** Props for {@link MainContentSummary}. */
export interface MainContentSummaryProps {
	/** Diagnostic tag+id+class selector for the detected main-content element, or `null` when none was found. */
	selector: string | null;
	/** Character count of the main region's text content. */
	wordCount: number;
	/** Character count of `document.body`'s text content. */
	bodyWordCount: number;
	/** `document.body.scrollHeight` at the desktop-compact and mobile-small presets. */
	scrollHeight: {
		/** Height at the desktop-compact preset, or `null` if unmeasured. */
		desktop: number | null;
		/** Height at the mobile-small preset, or `null` if unmeasured. */
		mobile: number | null;
	};
}

/**
 * Summary metrics for a page's detected main-content region: selector, word
 * counts, and scroll heights. The region's headings/images/tables/etc. are
 * each their own component — this one covers only the scalar metrics.
 * @param props - The main-content summary metrics.
 * @returns The summary `<dl>` element.
 */
export function MainContentSummary(props: MainContentSummaryProps) {
	const { t } = useI18n();
	const { selector, wordCount, bodyWordCount, scrollHeight } = props;
	return (
		<dl className="detail-grid">
			<dt>{t('views.pageDetail.mainContentSelector')}</dt>
			<dd>{selector ?? '—'}</dd>
			<dt>{t('views.pageDetail.mainContentWordCount')}</dt>
			<dd>{wordCount}</dd>
			<dt>{t('views.pageDetail.mainContentBodyWordCount')}</dt>
			<dd>{bodyWordCount}</dd>
			<dt>{t('views.pageDetail.mainContentScrollHeight')}</dt>
			<dd>
				{scrollHeight.desktop ?? '—'} / {scrollHeight.mobile ?? '—'}
			</dd>
		</dl>
	);
}
