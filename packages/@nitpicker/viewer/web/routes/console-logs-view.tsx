import type { ConsoleLogSummaryEntry } from '@nitpicker/query';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { useConsoleLogsInfinite } from '../api/use-console-logs-infinite.js';
import { usePagedQuery } from '../api/use-paged-query.js';
import {
	addChecklistFilter,
	addSort,
	createTableControls,
} from '../components/create-table-controls.js';
import { DataTable } from '../components/data-table.js';
import { ViewHeader } from '../components/view-header.js';
import { useListPagination } from '../hooks/use-list-pagination.js';
import { useUrlFilter } from '../hooks/use-url-filter.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * The console logs view: distinct console messages / page errors,
 * aggregated across every page they occurred on (issue #228). Filterable by
 * type, sortable by occurrence count. Rendered via the user's chosen
 * pagination mode.
 * @returns The console logs view element.
 */
export function ConsoleLogsView() {
	const { params, updateMany } = useUrlFilter();
	const { t } = useI18n();
	const { mode, pageSize, currentPage, setPage, setPageSize } = useListPagination();
	const filter = {
		type: params.getAll('type'),
		sortBy: params.get('sortBy') ?? undefined,
		sortOrder: params.get('sortOrder') ?? undefined,
	};

	const offset = (currentPage - 1) * pageSize;
	const paged = usePagedQuery<ConsoleLogSummaryEntry>(
		'/api/console-logs',
		{ ...filter, limit: pageSize, offset },
		['console-logs-paged', filter, pageSize, currentPage],
		{ enabled: mode === 'mpa' },
	);
	const infinite = useConsoleLogsInfinite(filter, { enabled: mode === 'virtual' });
	const infiniteRows = useMemo(
		() => infinite.data?.pages.flatMap((page) => page.items) ?? [],
		[infinite.data],
	);
	const infiniteTotal = infinite.data?.pages[0]?.total ?? 0;

	const columns = useMemo<ColumnDef<ConsoleLogSummaryEntry>[]>(
		() => [
			{
				accessorKey: 'type',
				header: t('views.consoleLogs.colType'),
				size: 100,
				cell: (i) => i.getValue<string>(),
			},
			{
				accessorKey: 'text',
				header: t('views.consoleLogs.colText'),
				size: 420,
				cell: (i) => i.getValue<string>(),
			},
			{
				accessorKey: 'locationUrl',
				header: t('views.consoleLogs.colLocation'),
				size: 260,
				cell: (i) => i.getValue<string | null>() ?? t('common.none'),
			},
			{
				accessorKey: 'pageCount',
				header: t('views.consoleLogs.colPageCount'),
				size: 100,
				cell: (i) => i.getValue<number>(),
			},
			{
				accessorKey: 'totalCount',
				header: t('views.consoleLogs.colTotalCount'),
				size: 100,
				cell: (i) => i.getValue<number>(),
			},
		],
		[t],
	);
	const columnControls = useMemo(() => {
		const context = { params, updateMany };
		const controls = createTableControls(context);
		addSort(controls, context, 'type', 'type');
		addSort(controls, context, 'text', 'text');
		addSort(controls, context, 'pageCount', 'pageCount');
		addSort(controls, context, 'totalCount', 'totalCount');
		addChecklistFilter(
			controls,
			context,
			'type',
			'type',
			t('views.consoleLogs.filterType'),
			[
				{ value: 'pageerror', label: 'pageerror' },
				{ value: 'error', label: 'error' },
				{ value: 'warn', label: 'warn' },
				{ value: 'log', label: 'log' },
				{ value: 'info', label: 'info' },
				{ value: 'debug', label: 'debug' },
			],
		);
		return controls;
	}, [params, t, updateMany]);

	return (
		<div className="view">
			<ViewHeader
				titleKey="views.consoleLogs.title"
				descriptionKey="views.consoleLogs.description"
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
