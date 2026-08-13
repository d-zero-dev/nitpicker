import type { MainContentVideoEntry } from '@nitpicker/query';

import { useI18n } from '../i18n/use-i18n.js';

/** Props for {@link VideoList}. */
export interface VideoListProps {
	/** Videos within the main region, in DOM order. */
	videos: readonly MainContentVideoEntry[];
}

/**
 * Videos found within a page's detected main-content region.
 * @param props - The video entries to render.
 * @returns The videos section, or `null` when there are none.
 */
export function VideoList(props: VideoListProps) {
	const { t } = useI18n();
	const { videos } = props;
	if (videos.length === 0) {
		return null;
	}
	return (
		<>
			<h3>
				{t('views.pageDetail.mainContentVideos')} ({videos.length})
			</h3>
			<ul>
				{videos.map((video, index) => (
					<li key={index}>
						{video.src} ({video.width}×{video.height})
					</li>
				))}
			</ul>
		</>
	);
}
