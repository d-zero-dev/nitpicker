import type { IsolatedClusterMember, IsolatedClusterSummary } from '@nitpicker/query';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { useIsolatedCluster } from '../api/use-isolated-cluster.js';
import { useIsolatedClustersInfinite } from '../api/use-isolated-clusters-infinite.js';
import { usePagedQuery } from '../api/use-paged-query.js';
import {
	addRadioFilter,
	addSort,
	addTextFilter,
	createTableControls,
} from '../components/create-table-controls.js';
import { DataTable } from '../components/data-table.js';
import { SourceBadge } from '../components/source-badge.js';
import { ViewHeader } from '../components/view-header.js';
import { useListPagination } from '../hooks/use-list-pagination.js';
import { useUrlFilter } from '../hooks/use-url-filter.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * **孤立集合** master-detail view. The list mode (no `?cluster=…` query
 * param) shows interconnected inventory-* cluster summaries; clicking a row
 * sets the param and switches to the detail mode where every cluster member
 * is listed. Both modes use the shared {@link DataTable} so the displayed
 * row count always matches the reported total in both pagination modes.
 * @returns The isolated clusters view element.
 */
export function IsolatedClustersView() {
	const { params, update } = useUrlFilter();
	const cluster = params.get('cluster');

	if (cluster === null || cluster.length === 0) {
		return (
			<ClusterListPane
				onSelectCluster={(url) => {
					update('cluster', url);
				}}
			/>
		);
	}
	return (
		<ClusterDetailPane
			representativeUrl={cluster}
			onBack={() => {
				update('cluster', '');
			}}
		/>
	);
}

/**
 * Renders the paginated list of cluster summaries. Each row is keyboard-
 * accessible (button role with `onClick`) so the operator can drill into the
 * cluster without a mouse.
 * @param props - Component props.
 * @param props.onSelectCluster - Called with the cluster's representativeUrl when the operator drills in.
 * @returns The list pane element.
 */
function ClusterListPane({
	onSelectCluster,
}: {
	onSelectCluster: (representativeUrl: string) => void;
}) {
	const { t } = useI18n();
	const { params, updateMany } = useUrlFilter();
	const { mode, pageSize, currentPage, setPage, setPageSize } = useListPagination();
	const filter = {
		urlPattern: params.get('urlPattern') ?? undefined,
		sortBy: params.get('sortBy') ?? undefined,
		sortOrder: params.get('sortOrder') ?? undefined,
	};

	const offset = (currentPage - 1) * pageSize;
	const paged = usePagedQuery<IsolatedClusterSummary>(
		'/api/isolated-clusters',
		{ ...filter, limit: pageSize, offset },
		['isolated-clusters-paged', filter, pageSize, currentPage],
		{ enabled: mode === 'mpa' },
	);
	const infinite = useIsolatedClustersInfinite({ enabled: mode === 'virtual' });
	const infiniteRows = useMemo(
		() => infinite.data?.pages.flatMap((page) => page.items) ?? [],
		[infinite.data],
	);
	const infiniteTotal = infinite.data?.pages[0]?.total ?? 0;

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
	const columnControls = useMemo(() => {
		const context = { params, updateMany };
		const controls = createTableControls(context);
		for (const key of [
			'representativeUrl',
			'size',
			'representativeTitle',
			'representativeStatus',
		]) {
			addSort(controls, context, key, key);
		}
		addTextFilter(
			controls,
			context,
			'representativeUrl',
			'urlPattern',
			t('views.pages.filterUrlPattern'),
		);
		return controls;
	}, [params, t, updateMany]);

	return (
		<div className="view">
			<ViewHeader
				titleKey="views.isolatedClusters.title"
				descriptionKey="views.isolatedClusters.description"
			/>
			{mode === 'mpa' ? (
				<DataTable
					mode="mpa"
					columns={columns}
					data={paged.data?.items ?? []}
					total={paged.data?.total ?? 0}
					currentPage={currentPage}
					pageSize={pageSize}
					onPageChange={setPage}
					onPageSizeChange={setPageSize}
					isFetching={paged.isFetching}
					isLoading={paged.isLoading}
					isError={paged.isError}
					error={paged.error}
					columnControls={columnControls}
				/>
			) : (
				<DataTable
					mode="virtual"
					columns={columns}
					data={infiniteRows}
					total={infiniteTotal}
					hasNextPage={infinite.hasNextPage}
					isFetching={infinite.isFetching}
					isLoading={infinite.isLoading}
					isError={infinite.isError}
					error={infinite.error}
					onLoadMore={() => {
						void infinite.fetchNextPage();
					}}
				/>
			)}
		</div>
	);
}

/**
 * Renders one cluster's full member list. The whole result fits in memory
 * — `getIsolatedCluster` returns the cluster in one shot — so MPA mode
 * slices the static `members` array client-side and virtual mode hands the
 * full array to the windowed table.
 * @param props - Component props.
 * @param props.representativeUrl - The cluster's representative URL.
 * @param props.onBack - Called when the operator navigates back to the cluster list.
 * @returns The detail pane element.
 */
function ClusterDetailPane({
	representativeUrl,
	onBack,
}: {
	representativeUrl: string;
	onBack: () => void;
}) {
	const { t } = useI18n();
	const { params, updateMany } = useUrlFilter();
	const { mode, pageSize, currentPage, setPage, setPageSize } = useListPagination();
	const offset = (currentPage - 1) * pageSize;
	const filter = {
		urlPattern: params.get('urlPattern') ?? undefined,
		source: params.get('source') ?? undefined,
		sortBy: params.get('sortBy') ?? undefined,
		sortOrder: params.get('sortOrder') ?? undefined,
		limit: mode === 'mpa' ? pageSize : undefined,
		offset: mode === 'mpa' ? offset : undefined,
	};
	const { data, isLoading, isError, error } = useIsolatedCluster(
		representativeUrl,
		filter,
	);

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
	const columnControls = useMemo(() => {
		const context = { params, updateMany };
		const controls = createTableControls(context);
		for (const key of ['url', 'title', 'status', 'source']) {
			addSort(controls, context, key, key);
		}
		addTextFilter(
			controls,
			context,
			'url',
			'urlPattern',
			t('views.pages.filterUrlPattern'),
		);
		addRadioFilter(controls, context, 'source', 'source', t('common.source'), [
			{ value: '', label: t('common.all'), checked: false },
			{ value: 'crawled', label: 'crawled', checked: false },
			{ value: 'inventory-seed', label: 'inventory-seed', checked: false },
			{ value: 'inventory-discovered', label: 'inventory-discovered', checked: false },
		]);
		return controls;
	}, [params, t, updateMany]);

	const members = data?.members ?? [];
	const total = data?.size ?? members.length;

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
			{/* Error rendering is delegated to <DataTable> (one banner per failed query). */}
			{mode === 'mpa' ? (
				<DataTable
					mode="mpa"
					columns={columns}
					data={members}
					total={total}
					currentPage={currentPage}
					pageSize={pageSize}
					onPageChange={setPage}
					onPageSizeChange={setPageSize}
					isFetching={false}
					isLoading={isLoading}
					isError={isError}
					error={error}
					columnControls={columnControls}
				/>
			) : (
				<DataTable
					mode="virtual"
					columns={columns}
					data={members}
					total={total}
					hasNextPage={false}
					isFetching={false}
					isLoading={isLoading}
					isError={isError}
					error={error}
					onLoadMore={() => {}}
				/>
			)}
		</div>
	);
}
