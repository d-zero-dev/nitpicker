import type { ExternalLinkEntry } from '@nitpicker/query';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';
import { useNavigate } from 'react-router';

import { useExternalLinksInfinite } from '../api/use-external-links-infinite.js';
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
 * The external-links view: unique external destinations reached from the
 * site, deduplicated by canonical (redirect-resolved) target, one row per
 * destination with a referrer count. Clicking a destination opens its Page
 * Detail view, whose inbound-links section lists every referring internal
 * page. Rendered via the user's chosen pagination mode.
 * @returns The external-links view element.
 */
export function ExternalLinksView() {
	const { params, updateMany } = useUrlFilter();
	const navigate = useNavigate();
	const { t } = useI18n();
	const { mode, pageSize, currentPage, setPage, setPageSize } = useListPagination();
	const status = params.get('status');
	const statusValue = status == null ? undefined : Number(status);
	const filter = {
		urlPattern: params.get('urlPattern') ?? undefined,
		status: Number.isFinite(statusValue) ? statusValue : undefined,
		sortBy: params.get('sortBy') ?? undefined,
		sortOrder: params.get('sortOrder') ?? undefined,
	};

	const offset = (currentPage - 1) * pageSize;
	const paged = usePagedQuery<ExternalLinkEntry>(
		'/api/links',
		{ type: 'external', ...filter, limit: pageSize, offset },
		['external-links-paged', filter, pageSize, currentPage],
		{ enabled: mode === 'mpa' },
	);
	const infinite = useExternalLinksInfinite(filter, { enabled: mode === 'virtual' });
	const infiniteRows = useMemo(
		() => infinite.data?.pages.flatMap((page) => page.items) ?? [],
		[infinite.data],
	);
	const infiniteTotal = infinite.data?.pages[0]?.total ?? 0;

	const columns = useMemo<ColumnDef<ExternalLinkEntry>[]>(
		() => [
			{
				accessorKey: 'destUrl',
				header: t('views.externalLinks.colDest'),
				size: 420,
				cell: (info) => (
					<button
						type="button"
						className="link-button"
						onClick={() => {
							void navigate(
								`/pages/detail?url=${encodeURIComponent(info.row.original.destUrl)}`,
							);
						}}>
						{info.getValue<string>()}
					</button>
				),
			},
			{
				accessorKey: 'status',
				header: t('views.externalLinks.colStatus'),
				size: 90,
				cell: (i) => i.getValue<number | null>() ?? '—',
			},
			{
				accessorKey: 'referrerCount',
				header: t('views.externalLinks.colReferrers'),
				size: 120,
				cell: (i) => i.getValue<number>(),
			},
		],
		[navigate, t],
	);
	const columnControls = useMemo(() => {
		const context = { params, updateMany };
		const controls = createTableControls(context);
		for (const key of ['destUrl', 'status', 'referrerCount']) {
			addSort(controls, context, key, key);
		}
		addTextFilter(
			controls,
			context,
			'destUrl',
			'urlPattern',
			t('views.pages.filterUrlPattern'),
		);
		addRadioFilter(
			controls,
			context,
			'status',
			'status',
			t('views.externalLinks.colStatus'),
			buildStatusFilterOptions(
				paged.data?.items,
				(item) => item.status,
				status,
				t('common.all'),
			),
		);
		return controls;
	}, [paged.data?.items, params, status, t, updateMany]);

	return (
		<div className="view">
			<ViewHeader
				titleKey="views.externalLinks.title"
				descriptionKey="views.externalLinks.description"
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
