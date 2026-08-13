import type { DataTableProps } from './data-table.js';
import type { IsolatedClusterSummary } from '@nitpicker/query';

import { DataTable } from './data-table.js';
import { ViewHeader } from './view-header.js';

/** Props for {@link IsolatedClusterListPane} — verbatim {@link DataTable} props for the cluster-summary row shape. */
export type IsolatedClusterListPaneProps = DataTableProps<IsolatedClusterSummary>;

/**
 * Presentational half of the **孤立集合** list mode: the view heading plus
 * the paginated cluster-summary table. Holds no data-fetching hooks — the
 * `isolated-clusters-view.tsx` container computes `columns`/`columnControls`
 * and both pagination modes' data, then forwards them here verbatim,
 * matching the `web/components/` "no data-fetching hooks" convention (see
 * `ContentTypeStackedBar`).
 * @param props - The active pagination mode's table props.
 * @returns The list pane element.
 */
export function IsolatedClusterListPane(props: IsolatedClusterListPaneProps) {
	return (
		<div className="view">
			<ViewHeader
				titleKey="views.isolatedClusters.title"
				descriptionKey="views.isolatedClusters.description"
			/>
			<DataTable {...props} />
		</div>
	);
}
