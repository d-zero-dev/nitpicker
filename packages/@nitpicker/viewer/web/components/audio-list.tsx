import type { MainContentAudioEntry } from '@nitpicker/query';

import { useI18n } from '../i18n/use-i18n.js';

/** Props for {@link AudioList}. */
export interface AudioListProps {
	/** Audios within the main region, in DOM order. */
	audios: readonly MainContentAudioEntry[];
}

/**
 * Audio elements found within a page's detected main-content region.
 * @param props - The audio entries to render.
 * @returns The audios section, or `null` when there are none.
 */
export function AudioList(props: AudioListProps) {
	const { t } = useI18n();
	const { audios } = props;
	if (audios.length === 0) {
		return null;
	}
	return (
		<>
			<h3>
				{t('views.pageDetail.mainContentAudios')} ({audios.length})
			</h3>
			<ul>
				{audios.map((audio, index) => (
					<li key={index}>{audio.src}</li>
				))}
			</ul>
		</>
	);
}
