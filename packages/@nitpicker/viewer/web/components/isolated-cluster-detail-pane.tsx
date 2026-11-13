import type { DataTableProps } from './data-table.js';
import type { IsolatedClusterMember } from '@nitpicker/query';
import type { To } from 'react-router';

import { useI18n } from '../i18n/use-i18n.js';

import { AppLink } from './app-link.js';
import { DataTable } from './data-table.js';
import { ExternalUrl } from './external-url.js';
import { ViewHeader } from './view-header.js';

/** Props for {@link IsolatedClusterDetailPane}. */
export type IsolatedClusterDetailPaneProps = DataTableProps<IsolatedClusterMember> & {
	/** The cluster's representative URL, shown above the member table. */
	representativeUrl: string;
	/** Where the back link goes: the cluster list. */
	backTo: To;
};

/**
 * Presentational half of the **孤立集合** detail mode: the back button, the
 * view heading, the representative URL, and the paginated member table.
 * Holds no data-fetching hooks — the `isolated-clusters-view.tsx` container
 * fetches the cluster and computes `columns`/`columnControls`, then forwards
 * them here verbatim, matching the `web/components/` "no data-fetching
 * hooks" convention (see `ContentTypeStackedBar`).
 * @param props - The representative URL, the back link target, and the active
 *   pagination mode's table props.
 * @returns The detail pane element.
 */
export function IsolatedClusterDetailPane(props: IsolatedClusterDetailPaneProps) {
	const { t } = useI18n();
	return (
		<div className="view">
			<AppLink className="link-button" to={props.backTo}>
				{t('views.isolatedClusters.back')}
			</AppLink>
			<ViewHeader
				titleKey="views.isolatedClusters.detailTitle"
				descriptionKey="views.isolatedClusters.description"
			/>
			<p>
				<code>
					<ExternalUrl url={props.representativeUrl} />
				</code>
			</p>
			{/* Error rendering is delegated to <DataTable> (one banner per failed query).
			    `props` itself satisfies `DataTableProps<IsolatedClusterMember>` (it's an
			    intersection with that type), so it can be forwarded verbatim — same as
			    the sibling `IsolatedClusterListPane`. JSX spread isn't subject to excess-
			    property checks, so the extra `representativeUrl`/`backTo` fields are fine. */}
			<DataTable {...props} />
		</div>
	);
}
