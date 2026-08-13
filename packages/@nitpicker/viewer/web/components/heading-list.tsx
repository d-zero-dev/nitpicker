import type { MainContentHeadingEntry } from '@nitpicker/query';

import { useI18n } from '../i18n/use-i18n.js';

/** Props for {@link HeadingList}. */
export interface HeadingListProps {
	/** Headings within the main region, in DOM order. */
	headings: readonly MainContentHeadingEntry[];
}

/**
 * Headings found within a page's detected main-content region.
 * @param props - The heading entries to render.
 * @returns The headings section, or `null` when there are none.
 */
export function HeadingList(props: HeadingListProps) {
	const { t } = useI18n();
	const { headings } = props;
	if (headings.length === 0) {
		return null;
	}
	return (
		<>
			<h3>
				{t('views.pageDetail.mainContentHeadings')} ({headings.length})
			</h3>
			<ul>
				{headings.map((heading, index) => (
					<li key={index}>
						H{heading.level}: {heading.text ?? '—'}
					</li>
				))}
			</ul>
		</>
	);
}
