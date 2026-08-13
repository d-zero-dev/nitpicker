import type { MainContentCustomElementEntry } from '@nitpicker/query';

import { useI18n } from '../i18n/use-i18n.js';

/** Props for {@link CustomElementList}. */
export interface CustomElementListProps {
	/** Web Components (custom elements) within the main region, in DOM order. */
	customElements: readonly MainContentCustomElementEntry[];
}

/**
 * Web Components (custom elements) found within a page's detected
 * main-content region.
 * @param props - The custom element entries to render.
 * @returns The custom elements section, or `null` when there are none.
 */
export function CustomElementList(props: CustomElementListProps) {
	const { t } = useI18n();
	const { customElements } = props;
	if (customElements.length === 0) {
		return null;
	}
	return (
		<>
			<h3>
				{t('views.pageDetail.mainContentCustomElements')} ({customElements.length})
			</h3>
			<ul>
				{customElements.map((element, index) => (
					<li key={index}>
						{element.nodeName.toLowerCase()}
						{element.elementId ? ` #${element.elementId}` : ''}
						{element.classList.length > 0 ? ` .${element.classList.join('.')}` : ''}
					</li>
				))}
			</ul>
		</>
	);
}
