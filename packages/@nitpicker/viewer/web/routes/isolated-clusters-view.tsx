import type { IsolatedClusterMember, IsolatedClusterSummary } from '@nitpicker/query';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';
import { useSearchParams } from 'react-router';

import { useIsolatedCluster } from '../api/use-isolated-cluster.js';
import { useIsolatedClustersInfinite } from '../api/use-isolated-clusters-infinite.js';
import { SourceBadge } from '../components/source-badge.js';
import { ViewHeader } from '../components/view-header.js';
import { VirtualTable } from '../components/virtual-table.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * **孤立集合** master-detail view. The list mode (no `?cluster=…` query
 * param) shows interconnected inventory-* cluster summaries; clicking a
 * row sets the param and switches to the detail mode where every cluster
 * member is listed. Both modes use the shared `VirtualTable` component
 * so the displayed row count always matches the reported total — same UX
 * promise as the Isolated Pages view.
 * @returns The isolated clusters view element.
 */
export function IsolatedClustersView() {
	const [params, setParams] = useSearchParams();
	const cluster = params.get('cluster');

	if (cluster === null || cluster.length === 0) {
		return (
			<ClusterListPane
				onSelectCluster={(url) => {
					// Clone the current params so unrelated keys (e.g. a
					// future `lang=` deep-link) survive the drill-in. The
					// short-hand `setParams({ cluster: url })` REPLACES the
					// whole URLSearchParams object, which would silently
					// strip them.
					const next = new URLSearchParams(params);
					next.set('cluster', url);
					setParams(next);
				}}
			/>
		);
	}
	return (
		<ClusterDetailPane
			representativeUrl={cluster}
			onBack={() => {
				const next = new URLSearchParams(params);
				next.delete('cluster');
				setParams(next);
			}}
		/>
	);
}

/**
 * Renders the paginated list of cluster summaries. Each row is keyboard-
 * accessible (button role with `onClick`) so the operator can drill into
 * the cluster without a mouse.
 * @param props - Component props.
 * @param props.onSelectCluster - Called with the cluster's representativeUrl when the operator drills in.
 */
function ClusterListPane({
	onSelectCluster,
}: {
	onSelectCluster: (representativeUrl: string) => void;
}) {
	const { t } = useI18n();
	const { data, fetchNextPage, hasNextPage, isFetching, isLoading } =
		useIsolatedClustersInfinite();
	const rows = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
	const total = data?.pages[0]?.total ?? 0;

	const columns = useMemo<ColumnDef<IsolatedClusterSummary>[]>(
		() => [
			{
				id: 'representativeUrl',
				header: t('views.isolatedClusters.representativeUrl'),
				size: 480,
				accessorFn: (r) => r.representativeUrl,
				cell: (info) => {
					const url = info.getValue<string>();
					return (
						<button
							type="button"
							className="link-button"
							onClick={() => onSelectCluster(url)}>
							<code>{url}</code>
						</button>
					);
				},
			},
			{
				id: 'size',
				header: t('views.isolatedClusters.size'),
				size: 80,
				accessorFn: (r) => r.size,
			},
			{
				id: 'representativeTitle',
				header: t('views.isolatedClusters.pageTitle'),
				size: 280,
				accessorFn: (r) => r.representativeTitle ?? '—',
			},
			{
				id: 'representativeStatus',
				header: t('views.isolatedClusters.status'),
				size: 90,
				accessorFn: (r) => r.representativeStatus ?? '—',
			},
		],
		[t, onSelectCluster],
	);

	return (
		<div className="view">
			<ViewHeader
				titleKey="views.isolatedClusters.title"
				descriptionKey="views.isolatedClusters.description"
			/>
			<VirtualTable
				data={rows}
				columns={columns}
				total={total}
				hasNextPage={hasNextPage}
				isFetching={isFetching}
				isLoading={isLoading}
				onLoadMore={() => {
					void fetchNextPage();
				}}
			/>
		</div>
	);
}

/**
 * Renders one cluster's full member list. The whole result fits in memory
 * — `getIsolatedCluster` returns the cluster in one shot — so a plain
 * `VirtualTable` over the static `members` array gives identical UX to
 * the rest of the viewer without an extra paginated endpoint.
 * @param props - Component props.
 * @param props.representativeUrl - The cluster's representative URL.
 * @param props.onBack - Called when the operator navigates back to the cluster list.
 */
function ClusterDetailPane({
	representativeUrl,
	onBack,
}: {
	representativeUrl: string;
	onBack: () => void;
}) {
	const { t } = useI18n();
	const { data, isLoading, isError, error } = useIsolatedCluster(representativeUrl);

	const columns = useMemo<ColumnDef<IsolatedClusterMember>[]>(
		() => [
			{
				id: 'url',
				header: t('views.isolatedClusters.memberUrl'),
				size: 440,
				accessorFn: (r) => r.url,
				cell: (info) => <code>{info.getValue<string>()}</code>,
			},
			{
				id: 'title',
				header: t('views.isolatedClusters.pageTitle'),
				size: 280,
				accessorFn: (r) => r.title ?? '—',
			},
			{
				id: 'status',
				header: t('views.isolatedClusters.status'),
				size: 90,
				accessorFn: (r) => r.status ?? '—',
			},
			{
				id: 'source',
				header: t('views.isolatedClusters.memberSource'),
				size: 110,
				accessorFn: (r) => r.source,
				cell: (info) => (
					<SourceBadge source={info.getValue<IsolatedClusterMember['source']>()} />
				),
			},
		],
		[t],
	);

	return (
		<div className="view">
			<button type="button" className="link-button" onClick={onBack}>
				{t('views.isolatedClusters.back')}
			</button>
			<ViewHeader
				titleKey="views.isolatedClusters.detailTitle"
				descriptionKey="views.isolatedClusters.description"
			/>
			<p>
				<code>{representativeUrl}</code>
			</p>
			{isError ? <p className="error">{error.message}</p> : null}
			<VirtualTable
				data={data?.members ?? []}
				columns={columns}
				total={data?.size ?? 0}
				hasNextPage={false}
				isFetching={false}
				isLoading={isLoading}
				onLoadMore={() => {}}
			/>
		</div>
	);
}
