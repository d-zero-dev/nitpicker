import type { LinkRow } from '../api/use-links-infinite.js';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { useLinksInfinite } from '../api/use-links-infinite.js';
import { usePagedQuery } from '../api/use-paged-query.js';
import { buildStatusFilterOptions } from '../components/build-status-filter-options.js';
import {
	addChecklistFilter,
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
 * Reads a string property from a link row.
 * @param row - The link row.
 * @param key - The property name.
 * @returns The stringified value, or an empty string if absent.
 */
function field(row: LinkRow, key: string): string {
	const value = (row as unknown as Record<string, unknown>)[key];
	return value == null ? '' : String(value);
}

/**
 * The broken-links view: anchors whose canonical destination resolves to
 * HTTP 404. Rendered via the user's chosen pagination mode.
 * @returns The broken-links view element.
 */
export function BrokenLinksView() {
	const { params, updateMany } = useUrlFilter();
	const { t } = useI18n();
	const { mode, pageSize, currentPage, setPage, setPageSize } = useListPagination();

	const status = params.getAll('status');
	const filter = {
		urlPattern: params.get('urlPattern') ?? undefined,
		status: status.length > 0 ? status : undefined,
		sortBy: params.get('sortBy') ?? undefined,
		sortOrder: params.get('sortOrder') ?? undefined,
	};

	const offset = (currentPage - 1) * pageSize;
	const paged = usePagedQuery<LinkRow>(
		'/api/links',
		{ type: 'broken', ...filter, limit: pageSize, offset },
		['broken-links-paged', filter, pageSize, currentPage],
		{ enabled: mode === 'mpa' },
	);
	const infinite = useLinksInfinite('broken', filter, { enabled: mode === 'virtual' });
	const infiniteRows = useMemo(
		() => infinite.data?.pages.flatMap((page) => page.items) ?? [],
		[infinite.data],
	);
	const infiniteTotal = infinite.data?.pages[0]?.total ?? 0;

	const columns = useMemo<ColumnDef<LinkRow>[]>(
		() => [
			{
				id: 'sourceUrl',
				header: t('views.brokenLinks.colSource'),
				size: 380,
				accessorFn: (r) => field(r, 'sourceUrl'),
			},
			{
				id: 'destUrl',
				header: t('views.brokenLinks.colDest'),
				size: 380,
				accessorFn: (r) => field(r, 'destUrl'),
			},
			{
				id: 'status',
				header: t('views.brokenLinks.colStatus'),
				size: 90,
				accessorFn: (r) => field(r, 'status') || '—',
			},
		],
		[t],
	);
	const columnControls = useMemo(() => {
		const context = { params, updateMany };
		const controls = createTableControls(context);
		for (const key of ['sourceUrl', 'destUrl', 'status']) {
			addSort(controls, context, key, key);
		}
		addTextFilter(
			controls,
			context,
			'sourceUrl',
			'urlPattern',
			t('views.pages.filterUrlPattern'),
		);
		addChecklistFilter(
			controls,
			context,
			'status',
			'status',
			t('views.brokenLinks.colStatus'),
			buildStatusFilterOptions({
				items: paged.data?.items,
				getStatus: (item) => item.status,
				currentStatuses: status,
			}),
		);
		addTextFilter(
			controls,
			context,
			'destUrl',
			'urlPattern',
			t('views.pages.filterUrlPattern'),
		);
		return controls;
	}, [paged.data?.items, params, status, t, updateMany]);

	return (
		<div className="view">
			<ViewHeader
				titleKey="views.brokenLinks.title"
				descriptionKey="views.brokenLinks.description"
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
