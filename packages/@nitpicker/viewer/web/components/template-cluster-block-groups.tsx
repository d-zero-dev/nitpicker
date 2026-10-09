import type { ClusterBlockGroup } from '../types.js';
import type { TemplateClusterSummary } from '@nitpicker/query';

import { useI18n } from '../i18n/use-i18n.js';

import { AppLink } from './app-link.js';
import { BlockHeadingLabel } from './block-heading-label.js';
import { ClusterName } from './cluster-name.js';
import { listClusterBlocks } from './list-cluster-blocks.js';
import { PropertyList } from './property-list.js';

/**
 * How many stylesheet file names a merged-from block names in a table cell
 * before collapsing to "+N more" — the block's own section lists them all.
 */
const MAX_MERGED_BLOCK_ITEMS = 2;

/** Props for {@link TemplateClusterBlockGroups}. */
export interface TemplateClusterBlockGroupsProps {
	/** Groups from `groupClustersByBlock`. */
	groups: readonly ClusterBlockGroup[];
}

/**
 * One section per page-cluster Pass-0 block, listing the clusters
 * that drew pages from it — the sibling relationship each cluster's own
 * section shows as cross-links, laid out as a tree. A cluster merged across
 * blocks is listed under each of them (see `groupClustersByBlock`), and its
 * row names the other blocks it came from so the repeat reads as intended.
 *
 * Each block's heading names the block; its cluster and page counts are
 * header properties rather than a parenthesised tail of the heading, so the
 * heading stays the block's name alone. Deliberately not `<details>`: the
 * block sections stay open so every cluster is scannable without clicking.
 * @param props - The block groups to render.
 * @returns The grouped sections, or `null` when there are no groups.
 */
export function TemplateClusterBlockGroups(props: TemplateClusterBlockGroupsProps) {
	const { t } = useI18n();
	const { groups } = props;

	if (groups.length === 0) {
		return null;
	}

	// The other-blocks cell reuses each block's own section label, so a reader
	// can find the section it points at by scanning for the same words.
	const groupByBlockKey = new Map(groups.map((group) => [group.block.blockKey, group]));
	const otherBlocksOf = (group: ClusterBlockGroup, cluster: TemplateClusterSummary) =>
		listClusterBlocks(cluster)
			.filter((block) => block.blockKey !== group.block.blockKey)
			.map((block) => {
				const target = groupByBlockKey.get(block.blockKey);
				return (
					<li key={block.blockKey}>
						{target ? (
							<BlockHeadingLabel group={target} maxItems={MAX_MERGED_BLOCK_ITEMS} />
						) : (
							<code>{block.blockKey}</code>
						)}
					</li>
				);
			});

	return (
		<section>
			<h2>{t('views.templateClusters.byBlock')}</h2>
			<p className="view-description">{t('views.templateClusters.byBlockCaveat')}</p>
			{groups.map((group) => (
				<section
					key={group.block.blockKey}
					className="block-card"
					aria-labelledby={headingId(group)}>
					<h3 id={headingId(group)}>
						<BlockHeadingLabel group={group} />
					</h3>
					<PropertyList
						items={[
							{
								label: t('views.templateClusters.colClusters'),
								value: group.clusters.length,
							},
							{ label: t('views.templateClusters.colPages'), value: group.pageCount },
						]}
					/>
					<div className="plain-table-scroll">
						<table className="plain-table">
							<thead>
								<tr>
									<th className="plain-table-nowrap">
										{t('views.templateClusters.colCluster')}
									</th>
									<th className="plain-table-num">
										{t('views.templateClusters.colPages')}
									</th>
									<th className="plain-table-nowrap">
										{t('views.templateClusters.colTopDirectory')}
									</th>
									<th>{t('views.templateClusters.colMergedBlocks')}</th>
								</tr>
							</thead>
							<tbody>
								{group.clusters.map((cluster) => (
									<tr key={cluster.templateKey}>
										<td className="plain-table-nowrap">
											<AppLink
												to={`/pages?templateKey=${encodeURIComponent(cluster.templateKey)}`}>
												<ClusterName cluster={cluster} />
											</AppLink>
										</td>
										<td className="plain-table-num">{cluster.pageCount}</td>
										<td className="plain-table-nowrap">
											{cluster.commonDirectories[0] ? (
												<code>{cluster.commonDirectories[0].directory}</code>
											) : (
												'—'
											)}
										</td>
										<td>
											{otherBlocksOf(group, cluster).length === 0 ? (
												'—'
											) : (
												<ul className="plain-list merged-blocks">
													{otherBlocksOf(group, cluster)}
												</ul>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
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
