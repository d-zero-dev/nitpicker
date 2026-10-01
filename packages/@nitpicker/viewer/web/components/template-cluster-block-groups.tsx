import type { ClusterBlockGroup } from '../types.js';
import type { TemplateClusterSummary } from '@nitpicker/query';

import { getBlockingKindLabel } from '../i18n/get-blocking-kind-label.js';
import { useI18n } from '../i18n/use-i18n.js';

import { AppLink } from './app-link.js';
import { buildBlockHeading } from './build-block-heading.js';
import { buildClusterHeading } from './build-cluster-heading.js';
import { listClusterBlocks } from './list-cluster-blocks.js';

/** Props for {@link TemplateClusterBlockGroups}. */
export interface TemplateClusterBlockGroupsProps {
	/** Groups from `groupClustersByBlock`. */
	groups: readonly ClusterBlockGroup[];
}

/**
 * One section per `@d-zero/page-cluster` Pass-0 block, listing the clusters
 * that drew pages from it — the sibling relationship each cluster's own
 * section shows as cross-links, laid out as a tree. A cluster merged across
 * blocks is listed under each of them (see `groupClustersByBlock`), and its
 * row names the other blocks it came from so the repeat reads as intended.
 *
 * Deliberately not `<details>`: the per-cluster sections below are the only
 * `<details>` on the view, which the viewer E2E specs rely on to locate a
 * cluster by its heading text.
 * @param props - The block groups to render.
 * @returns The grouped sections, or `null` when there are no groups.
 */
export function TemplateClusterBlockGroups(props: TemplateClusterBlockGroupsProps) {
	const { t } = useI18n();
	const { groups } = props;

	if (groups.length === 0) {
		return null;
	}

	// The other-blocks cell reuses each block's own section heading text, so a
	// reader can find the section it points at by scanning for the same words.
	const headingByBlockKey = new Map(
		groups.map((group) => [
			group.block.blockKey,
			`${getBlockingKindLabel(group.block.kind, t)}: ${buildBlockHeading(group)}`,
		]),
	);
	const otherBlocksOf = (group: ClusterBlockGroup, cluster: TemplateClusterSummary) =>
		listClusterBlocks(cluster)
			.filter((block) => block.blockKey !== group.block.blockKey)
			.map((block) => headingByBlockKey.get(block.blockKey) ?? block.blockKey);

	return (
		<section>
			<h2>{t('views.templateClusters.byBlock')}</h2>
			<p className="view-description">{t('views.templateClusters.byBlockCaveat')}</p>
			{groups.map((group) => (
				<section key={group.block.blockKey} aria-labelledby={headingId(group)}>
					<h3 id={headingId(group)}>
						{getBlockingKindLabel(group.block.kind, t)}: {buildBlockHeading(group)} (
						{t('views.templateClusters.colClusters')}: {group.clusters.length},{' '}
						{t('views.templateClusters.colPages')}: {group.pageCount})
					</h3>
					<table>
						<thead>
							<tr>
								<th>{t('views.templateClusters.colCluster')}</th>
								<th>{t('views.templateClusters.colPages')}</th>
								<th>{t('views.templateClusters.colTopDirectory')}</th>
								<th>{t('views.templateClusters.colMergedBlocks')}</th>
							</tr>
						</thead>
						<tbody>
							{group.clusters.map((cluster) => (
								<tr key={cluster.templateKey}>
									<td>
										<AppLink
											to={`/pages?templateKey=${encodeURIComponent(cluster.templateKey)}`}>
											{buildClusterHeading(cluster).heading}
										</AppLink>
									</td>
									<td>{cluster.pageCount}</td>
									<td>{cluster.commonDirectories[0]?.directory ?? '—'}</td>
									<td>{otherBlocksOf(group, cluster).join(', ') || '—'}</td>
								</tr>
							))}
						</tbody>
					</table>
				</section>
			))}
		</section>
	);
}

/**
 * Stable element id for a block group's heading, used to label its section.
 * @param group - The block group.
 * @returns The id.
 */
function headingId(group: ClusterBlockGroup): string {
	return `block-group-${encodeURIComponent(group.block.blockKey)}`;
}
