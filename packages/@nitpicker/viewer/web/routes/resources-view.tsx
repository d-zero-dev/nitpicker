import type { ResourceEntry } from '@nitpicker/query';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { usePagedQuery } from '../api/use-paged-query.js';
import { useResourcesInfinite } from '../api/use-resources-infinite.js';
import {
	addRadioFilter,
	addSort,
	addTextFilter,
	createTableControls,
} from '../components/create-table-controls.js';
import { DataTable } from '../components/data-table.js';
import { ViewHeader } from '../components/view-header.js';
import { useListPagination } from '../hooks/use-list-pagination.js';
import { useUrlFilter } from '../hooks/use-url-filter.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * The resource list: a filterable table of network resources, rendered via
 * the user's chosen pagination mode (MPA `?page=` by default, opt-in
 * virtual scroll).
 * @returns The resources view element.
 */
export function ResourcesView() {
	const { params, updateMany } = useUrlFilter();
	const { t } = useI18n();
	const { mode, pageSize, currentPage, setPage, setPageSize } = useListPagination();
	const scope = params.get('isExternal') ?? 'false';
	const filter = {
		contentType: params.get('contentType') ?? undefined,
		isExternal: scope === 'all' ? undefined : scope === 'true',
		sortBy: params.get('sortBy') ?? undefined,
		sortOrder: params.get('sortOrder') ?? undefined,
	};

	const offset = (currentPage - 1) * pageSize;
	const paged = usePagedQuery<ResourceEntry>(
		'/api/resources',
		{ ...filter, limit: pageSize, offset },
		['resources-paged', filter, pageSize, currentPage],
		{ enabled: mode === 'mpa' },
	);
	const infinite = useResourcesInfinite(filter, { enabled: mode === 'virtual' });
	const infiniteRows = useMemo(
		() => infinite.data?.pages.flatMap((page) => page.items) ?? [],
		[infinite.data],
	);
	const infiniteTotal = infinite.data?.pages[0]?.total ?? 0;

	const columns = useMemo<ColumnDef<ResourceEntry>[]>(
		() => [
			{
				accessorKey: 'url',
				header: t('views.resources.colUrl'),
				size: 420,
				cell: (i) => i.getValue<string>(),
			},
			{
				accessorKey: 'isExternal',
				header: t('common.type'),
				size: 90,
				cell: (i) =>
					i.getValue<boolean>() ? t('common.external') : t('common.internal'),
			},
			{
				accessorKey: 'status',
				header: t('views.resources.colStatus'),
				size: 80,
				cell: (i) => i.getValue<number | null>() ?? '—',
			},
			{
				accessorKey: 'statusText',
				header: t('views.resources.colStatusText'),
				size: 110,
				cell: (i) => i.getValue<string | null>() ?? '—',
			},
			{
				accessorKey: 'contentType',
				header: t('views.resources.colType'),
				size: 180,
				cell: (i) => i.getValue<string | null>() ?? '—',
			},
			{
				accessorKey: 'contentLength',
				header: t('views.resources.colSize'),
				size: 100,
				cell: (i) => i.getValue<number | null>()?.toLocaleString() ?? '—',
			},
			{
				accessorKey: 'referrerCount',
				header: t('views.resources.colReferrers'),
				size: 100,
				cell: (i) => i.getValue<number>(),
			},
		],
		[t],
	);
	const columnControls = useMemo(() => {
		const context = { params, updateMany };
		const controls = createTableControls(context);
		for (const key of [
			'url',
			'status',
			'statusText',
			'contentType',
			'contentLength',
			'isExternal',
			'referrerCount',
		]) {
			addSort(controls, context, key, key);
		}
		addTextFilter(
			controls,
			context,
			'url',
			'urlPattern',
			t('views.pages.filterUrlPattern'),
		);
		addTextFilter(
			controls,
			context,
			'contentType',
			'contentType',
			t('views.resources.filterContentType'),
		);
		addRadioFilter(controls, context, 'isExternal', 'isExternal', t('common.type'), [
			{ value: 'all', label: t('common.all'), checked: false },
			{ value: 'false', label: t('common.internal'), checked: false },
			{ value: 'true', label: t('common.external'), checked: false },
		]);
		return controls;
	}, [params, t, updateMany]);

	return (
		<div className="view">
			<ViewHeader
				titleKey="views.resources.title"
				descriptionKey="views.resources.description"
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
