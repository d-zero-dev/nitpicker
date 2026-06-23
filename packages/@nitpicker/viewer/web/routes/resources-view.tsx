import type { ResourceEntry } from '@nitpicker/query';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { usePagedQuery } from '../api/use-paged-query.js';
import { useResourcesInfinite } from '../api/use-resources-infinite.js';
import { DataTable } from '../components/data-table.js';
import { FilterBar } from '../components/filter-bar.js';
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
	const { params, update } = useUrlFilter();
	const { t } = useI18n();
	const { mode, pageSize, currentPage, setPage, setPageSize } = useListPagination();
	const includeExternal = params.get('includeExternal') === 'true';
	const filter = {
		contentType: params.get('contentType') ?? undefined,
		isExternal: includeExternal ? undefined : false,
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

	return (
		<div className="view">
			<ViewHeader
				titleKey="views.resources.title"
				descriptionKey="views.resources.description"
			/>
			<FilterBar>
				<input
					aria-label={t('views.resources.filterContentType')}
					placeholder={t('views.resources.filterContentType')}
					defaultValue={filter.contentType ?? ''}
					onBlur={(e) => {
						update('contentType', e.target.value);
					}}
				/>
				<label>
					<input
						type="checkbox"
						checked={includeExternal}
						onChange={(e) => {
							update('includeExternal', e.target.checked ? 'true' : '');
						}}
					/>
					{t('common.includeExternal')}
				</label>
			</FilterBar>
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
