import type { UnusedResourceEntry } from '@nitpicker/query';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

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
 * Unused resources view — lists internal sub-resources that no archived
 * page references. The `source` badge on each row tells the operator
 * whether a resource was once referenced and lost its referrers
 * (`crawled`) or was registered straight from the server file list
 * (`inventory-seed`) — useful when deciding what to delete.
 * @returns The unused resources view element.
 */
export function UnusedResourcesView() {
	const { t } = useI18n();
	const { params, updateMany } = useUrlFilter();
	const { pageSize, currentPage, setPage, setPageSize } = useListPagination();
	const filter = {
		urlPattern: params.get('urlPattern') ?? undefined,
		contentType: params.get('contentType') ?? undefined,
		source: params.get('source') ?? undefined,
		sortBy: params.get('sortBy') ?? undefined,
		sortOrder: params.get('sortOrder') ?? undefined,
	};
	const offset = (currentPage - 1) * pageSize;
	const paged = usePagedQuery<UnusedResourceEntry>(
		'/api/unused-resources',
		{ ...filter, limit: pageSize, offset },
		['unused-resources-paged', filter, pageSize, currentPage],
	);
	const columns = useMemo<ColumnDef<UnusedResourceEntry>[]>(
		() => [
			{
				accessorKey: 'url',
				header: t('views.unusedResources.url'),
				size: 420,
				cell: (i) => <code>{i.getValue<string>()}</code>,
			},
			{
				accessorKey: 'status',
				header: t('views.unusedResources.status'),
				size: 90,
				cell: (i) => i.getValue<number | null>() ?? '—',
			},
			{
				accessorKey: 'contentType',
				header: t('views.unusedResources.contentType'),
				size: 180,
				cell: (i) => i.getValue<string | null>() ?? '—',
			},
			{
				accessorKey: 'contentLength',
				header: t('views.unusedResources.contentLength'),
				size: 120,
				cell: (i) => i.getValue<number | null>() ?? '—',
			},
			{
				accessorKey: 'source',
				header: t('views.unusedResources.source'),
				size: 150,
				cell: (i) => <SourceBadge source={i.getValue<UnusedResourceEntry['source']>()} />,
			},
		],
		[t],
	);
	const columnControls = useMemo(() => {
		const context = { params, updateMany };
		const controls = createTableControls(context);
		for (const key of ['url', 'status', 'contentType', 'contentLength', 'source']) {
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
		addRadioFilter(controls, context, 'source', 'source', t('common.source'), [
			{ value: '', label: t('common.all'), checked: false },
			{ value: 'crawled', label: 'crawled', checked: false },
			{ value: 'inventory-seed', label: 'inventory-seed', checked: false },
		]);
		return controls;
	}, [params, t, updateMany]);

	return (
		<div className="view">
			<ViewHeader
				titleKey="views.unusedResources.title"
				descriptionKey="views.unusedResources.description"
			/>
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
		</div>
	);
}
