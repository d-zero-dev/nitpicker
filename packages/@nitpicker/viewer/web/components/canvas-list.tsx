import type { MainContentCanvasEntry } from '@nitpicker/query';

import { useI18n } from '../i18n/use-i18n.js';

/** Props for {@link CanvasList}. */
export interface CanvasListProps {
	/** Canvases within the main region, in DOM order. */
	canvases: readonly MainContentCanvasEntry[];
}

/**
 * Canvas elements found within a page's detected main-content region.
 * @param props - The canvas entries to render.
 * @returns The canvases section, or `null` when there are none.
 */
export function CanvasList(props: CanvasListProps) {
	const { t } = useI18n();
	const { canvases } = props;
	if (canvases.length === 0) {
		return null;
	}
	return (
		<>
			<h3>
				{t('views.pageDetail.mainContentCanvases')} ({canvases.length})
			</h3>
			<ul>
				{canvases.map((canvas, index) => (
					<li key={index}>
						{canvas.width}×{canvas.height}
					</li>
				))}
			</ul>
		</>
	);
}
