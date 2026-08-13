import type { MainContentImageEntry } from '@nitpicker/query';

import { useI18n } from '../i18n/use-i18n.js';

/** Props for {@link ImageList}. */
export interface ImageListProps {
	/** Images within the main region, in DOM order. */
	images: readonly MainContentImageEntry[];
}

/**
 * Images found within a page's detected main-content region.
 * @param props - The image entries to render.
 * @returns The images section, or `null` when there are none.
 */
export function ImageList(props: ImageListProps) {
	const { t } = useI18n();
	const { images } = props;
	if (images.length === 0) {
		return null;
	}
	return (
		<>
			<h3>
				{t('views.pageDetail.mainContentImages')} ({images.length})
			</h3>
			<ul>
				{images.map((image, index) => (
					<li key={index}>
						{image.src}
						{image.alt ? ` (alt: ${image.alt})` : ''}
					</li>
				))}
			</ul>
		</>
	);
}
