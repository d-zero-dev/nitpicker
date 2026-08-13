import type { MainContentButtonEntry } from '@nitpicker/query';

import { useI18n } from '../i18n/use-i18n.js';

/** Props for {@link ButtonList}. */
export interface ButtonListProps {
	/** Button-like elements within the main region, in DOM order. */
	buttons: readonly MainContentButtonEntry[];
}

/**
 * Button-like elements found within a page's detected main-content region.
 * @param props - The button entries to render.
 * @returns The buttons section, or `null` when there are none.
 */
export function ButtonList(props: ButtonListProps) {
	const { t } = useI18n();
	const { buttons } = props;
	if (buttons.length === 0) {
		return null;
	}
	return (
		<>
			<h3>
				{t('views.pageDetail.mainContentButtons')} ({buttons.length})
			</h3>
			<ul>
				{buttons.map((button, index) => (
					<li key={index}>
						{button.nodeName}
						{button.type ? `[${button.type}]` : ''}: {button.text ?? '—'}
						{button.disabled ? ' (disabled)' : ''}
					</li>
				))}
			</ul>
		</>
	);
}
