import type { ResourceEntry } from '@nitpicker/query';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { useResourcesInfinite } from '../api/use-resources-infinite.js';
import { FilterBar } from '../components/filter-bar.js';
import { ViewHeader } from '../components/view-header.js';
import { VirtualTable } from '../components/virtual-table.js';
import { useUrlFilter } from '../hooks/use-url-filter.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * The resource list: a virtualized, filterable table of network resources.
 * @returns The resources view element.
 */
export function ResourcesView() {
	const { params, update } = useUrlFilter();
	const { t } = useI18n();
	const includeExternal = params.get('includeExternal') === 'true';
	const filter = {
		contentType: params.get('contentType') ?? undefined,
		isExternal: includeExternal ? undefined : false,
	};

	const { data, fetchNextPage, hasNextPage, isFetching, isLoading } =
		useResourcesInfinite(filter);
	const rows = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
	const total = data?.pages[0]?.total ?? 0;

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
