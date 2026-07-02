import type { PageLinkEntry } from '@nitpicker/query';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';
import { useNavigate } from 'react-router';

import { usePageLinksInfinite } from '../api/use-page-links-infinite.js';
import { usePagedQuery } from '../api/use-paged-query.js';
import { buildStatusFilterOptions } from '../components/build-status-filter-options.js';
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
 * The page-links view: one row per page (google-sheets "Links" sheet) with
 * status, redirect-from / referrer counts, header presence, and remarks.
 * Rendered via the user's chosen pagination mode.
 * @returns The page-links view element.
 */
export function PageLinksView() {
	const { params, updateMany } = useUrlFilter();
	const navigate = useNavigate();
	const { t } = useI18n();
	const { mode, pageSize, currentPage, setPage, setPageSize } = useListPagination();
	const scope = params.get('isExternal') ?? 'false';
	const status = params.get('status');
	const statusValue = status == null ? undefined : Number(status);
	const filter = {
		isExternal: scope === 'all' ? undefined : scope === 'true',
		urlPattern: params.get('urlPattern') ?? undefined,
		status: Number.isFinite(statusValue) ? statusValue : undefined,
		contentType: params.get('contentType') ?? undefined,
		hasResponseHeaders:
			params.get('hasResponseHeaders') == null
				? undefined
				: params.get('hasResponseHeaders') === 'true',
		sortBy: params.get('sortBy') ?? undefined,
		sortOrder: params.get('sortOrder') ?? undefined,
	};

	const offset = (currentPage - 1) * pageSize;
	const paged = usePagedQuery<PageLinkEntry>(
		'/api/page-links',
		{ ...filter, limit: pageSize, offset },
		['page-links-paged', filter, pageSize, currentPage],
		{ enabled: mode === 'mpa' },
	);
	const infinite = usePageLinksInfinite(filter, { enabled: mode === 'virtual' });
	const infiniteRows = useMemo(
		() => infinite.data?.pages.flatMap((page) => page.items) ?? [],
		[infinite.data],
	);
	const infiniteTotal = infinite.data?.pages[0]?.total ?? 0;

	const columns = useMemo<ColumnDef<PageLinkEntry>[]>(
		() => [
			{
				accessorKey: 'url',
				header: t('views.pageLinks.colUrl'),
				size: 360,
				cell: (info) => (
					<button
						type="button"
						className="link-button"
						onClick={() => {
							void navigate(
								`/pages/detail?url=${encodeURIComponent(info.row.original.url)}`,
							);
						}}>
						{info.getValue<string>()}
					</button>
				),
			},
			{
				accessorKey: 'title',
				header: t('views.pageLinks.colTitle'),
				size: 220,
				cell: (i) => i.getValue<string | null>() ?? '—',
			},
			{
				accessorKey: 'status',
				header: t('views.pageLinks.colStatus'),
				size: 80,
				cell: (i) => i.getValue<number | null>() ?? '—',
			},
			{
				accessorKey: 'statusText',
				header: t('views.pageLinks.colStatusText'),
				size: 110,
				cell: (i) => i.getValue<string | null>() ?? '—',
			},
			{
				accessorKey: 'contentType',
				header: t('views.pageLinks.colType'),
				size: 150,
				cell: (i) => i.getValue<string | null>() ?? '—',
			},
			{
				accessorKey: 'isExternal',
				header: t('common.type'),
				size: 90,
				cell: (i) =>
					i.getValue<boolean>() ? t('common.external') : t('common.internal'),
			},
			{
				accessorKey: 'redirectFromCount',
				header: t('views.pageLinks.colRedirectFrom'),
				size: 110,
				cell: (i) => i.getValue<number>(),
			},
			{
				accessorKey: 'referrerCount',
				header: t('views.pageLinks.colReferrers'),
				size: 100,
				cell: (i) => i.getValue<number>(),
			},
			{
				accessorKey: 'hasResponseHeaders',
				header: t('views.pageLinks.colHeaders'),
				size: 90,
				cell: (i) => (i.getValue<boolean>() ? t('common.yes') : ''),
			},
			{
				accessorKey: 'skipReason',
				header: t('views.pageLinks.colRemarks'),
				size: 160,
				cell: (i) => i.getValue<string | null>() ?? '',
			},
		],
		[navigate, t],
	);
	const columnControls = useMemo(() => {
		const context = { params, updateMany };
		const controls = createTableControls(context);
		for (const key of [
			'url',
			'title',
			'status',
			'statusText',
			'contentType',
			'redirectFromCount',
			'referrerCount',
			'hasResponseHeaders',
			'skipReason',
			'isExternal',
		]) {
			addSort(controls, context, key, key);
		}
		addTextFilter(
			controls,
			context,
			'url',
			'urlPattern',
			t('views.pageLinks.filterUrlPattern'),
		);
		addRadioFilter(
			controls,
			context,
			'status',
			'status',
			t('views.pageLinks.colStatus'),
			buildStatusFilterOptions(
				paged.data?.items,
				(item) => item.status,
				status,
				t('common.all'),
			),
		);
		addTextFilter(
			controls,
			context,
			'contentType',
			'contentType',
			t('views.resources.filterContentType'),
		);
		addRadioFilter(
			controls,
			context,
			'isExternal',
			'isExternal',
			t('common.type'),
			[
				{ value: 'all', label: t('common.all'), checked: false },
				{ value: 'false', label: t('common.internal'), checked: false },
				{ value: 'true', label: t('common.external'), checked: false },
			],
			'false',
		);
		addRadioFilter(
			controls,
			context,
			'hasResponseHeaders',
			'hasResponseHeaders',
			t('views.pageLinks.colHeaders'),
			[
				{ value: '', label: t('common.all'), checked: false },
				{ value: 'true', label: t('common.yes'), checked: false },
				{ value: 'false', label: t('common.none'), checked: false },
			],
		);
		return controls;
	}, [paged.data?.items, params, status, t, updateMany]);

	return (
		<div className="view">
			<ViewHeader
				titleKey="views.pageLinks.title"
				descriptionKey="views.pageLinks.description"
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
