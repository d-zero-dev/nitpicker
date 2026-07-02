import type { IsolatedPageEntry } from '@nitpicker/query';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { useIsolatedPagesInfinite } from '../api/use-isolated-pages-infinite.js';
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
 * **完全孤立** page list: inventory-* HTML pages that form singleton
 * components in the inventory subgraph (no resolved-anchor inbound from any
 * other inventory-* node). Rendered via the user's chosen pagination mode —
 * MPA `?page=` by default, opt-in virtual scroll.
 * @returns The isolated pages view element.
 */
export function IsolatedPagesView() {
	const { t } = useI18n();
	const { params, updateMany } = useUrlFilter();
	const { mode, pageSize, currentPage, setPage, setPageSize } = useListPagination();
	const filter = {
		urlPattern: params.get('urlPattern') ?? undefined,
		source: params.get('source') ?? undefined,
		sortBy: params.get('sortBy') ?? undefined,
		sortOrder: params.get('sortOrder') ?? undefined,
	};

	const offset = (currentPage - 1) * pageSize;
	const paged = usePagedQuery<IsolatedPageEntry>(
		'/api/isolated-pages',
		{ ...filter, limit: pageSize, offset },
		['isolated-pages-paged', filter, pageSize, currentPage],
		{ enabled: mode === 'mpa' },
	);
	const infinite = useIsolatedPagesInfinite({ enabled: mode === 'virtual' });
	const infiniteRows = useMemo(
		() => infinite.data?.pages.flatMap((page) => page.items) ?? [],
		[infinite.data],
	);
	const infiniteTotal = infinite.data?.pages[0]?.total ?? 0;

	const columns = useMemo<ColumnDef<IsolatedPageEntry>[]>(
		() => [
			{
				id: 'url',
				header: t('views.isolatedPages.url'),
				size: 440,
				accessorFn: (r) => r.url,
				cell: (info) => <code>{info.getValue<string>()}</code>,
			},
			{
				id: 'title',
				header: t('views.isolatedPages.pageTitle'),
				size: 280,
				accessorFn: (r) => r.title ?? '—',
			},
			{
				id: 'status',
				header: t('views.isolatedPages.status'),
				size: 90,
				accessorFn: (r) => r.status ?? '—',
			},
			{
				id: 'source',
				header: t('views.isolatedPages.source'),
				size: 110,
				accessorFn: (r) => r.source,
				cell: (info) => (
					<SourceBadge source={info.getValue<IsolatedPageEntry['source']>()} />
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

	return (
		<div className="view">
			<ViewHeader
				titleKey="views.isolatedPages.title"
				descriptionKey="views.isolatedPages.description"
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
