import { useI18n } from '../i18n/use-i18n.js';

import { AppLink } from './app-link.js';

/** Props for {@link ClusterSiblingList}. */
export interface ClusterSiblingListProps {
	/** Template keys of sibling clusters that split off the same blocking group. */
	siblingClusterKeys: readonly string[];
}

/**
 * Renders the sibling clusters that split off the same
 * `@d-zero/page-cluster` blocking group as the current cluster, each linking
 * to its own filtered pages list.
 * @param props - The sibling cluster keys to render.
 * @returns The `<dt>`/`<dd>` pair element, or `null` when `siblingClusterKeys` is empty.
 */
export function ClusterSiblingList(props: ClusterSiblingListProps) {
	const { t } = useI18n();
	const { siblingClusterKeys } = props;

	if (siblingClusterKeys.length === 0) {
		return null;
	}

	return (
		<>
			<dt>{t('views.templateClusters.siblings')}</dt>
			<dd>
				<ul>
					{siblingClusterKeys.map((key) => (
						<li key={key}>
							<AppLink to={`/pages?templateKey=${encodeURIComponent(key)}`}>
								<code>{key}</code>
							</AppLink>
						</li>
					))}
				</ul>
				<p className="view-description">{t('views.templateClusters.siblingsCaveat')}</p>
			</dd>
		</>
	);
}
