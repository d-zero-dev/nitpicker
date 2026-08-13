import type { DirectoryDistributionEntry } from '@nitpicker/query';

import { useI18n } from '../i18n/use-i18n.js';

/** Props for {@link ClusterDirectoryDistributionList}. */
export interface ClusterDirectoryDistributionListProps {
	/** The top-N first-path-segment directories by member-page count. */
	directories: readonly DirectoryDistributionEntry[];
	/**
	 * Member pages outside every listed directory — see
	 * `computeClusterOtherPageCount`. Shown as a "N more" note beneath the
	 * list when positive.
	 */
	otherPageCount: number;
}

/**
 * Renders a cluster's top directories by member-page count, or a `—`
 * placeholder when `computeDirectoryDistribution` returned nothing (an
 * unparseable-URL edge case).
 * @param props - The directory distribution and long-tail count.
 * @returns The list (plus optional "N more" note), or the `—` placeholder.
 */
export function ClusterDirectoryDistributionList(
	props: ClusterDirectoryDistributionListProps,
) {
	const { t } = useI18n();
	const { directories, otherPageCount } = props;

	if (directories.length === 0) {
		return <>—</>;
	}

	return (
		<>
			<ul>
				{directories.map((entry) => (
					<li key={entry.directory}>
						{entry.directory} (
						{t('views.templateClusters.pageCount', { count: entry.pageCount })})
					</li>
				))}
			</ul>
			{otherPageCount > 0 && (
				<p className="view-description">
					{t('views.templateClusters.otherPages', { count: otherPageCount })}
				</p>
			)}
		</>
	);
}
