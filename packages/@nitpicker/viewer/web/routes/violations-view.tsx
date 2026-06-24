import type { ViolationEntry } from '../types.js';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { usePagedQuery } from '../api/use-paged-query.js';
import { useViolationsInfinite } from '../api/use-violations-infinite.js';
import { DataTable } from '../components/data-table.js';
import { FilterBar } from '../components/filter-bar.js';
import { ViewHeader } from '../components/view-header.js';
import { useListPagination } from '../hooks/use-list-pagination.js';
import { useUrlFilter } from '../hooks/use-url-filter.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * The analysis violations view: a table of axe/markuplint/etc. findings,
 * filterable by validator and severity. Rendered via the user's chosen
 * pagination mode.
 * @returns The violations view element.
 */
export function ViolationsView() {
	const { params, update } = useUrlFilter();
	const { t } = useI18n();
	const { mode, pageSize, currentPage, setPage, setPageSize } = useListPagination();
	const filter = {
		validator: params.get('validator') ?? undefined,
		severity: params.get('severity') ?? undefined,
		rule: params.get('rule') ?? undefined,
	};

	const offset = (currentPage - 1) * pageSize;
	const paged = usePagedQuery<ViolationEntry>(
		'/api/violations',
		{ ...filter, limit: pageSize, offset },
		['violations-paged', filter, pageSize, currentPage],
		{ enabled: mode === 'mpa' },
	);
	const infinite = useViolationsInfinite(filter, { enabled: mode === 'virtual' });
	const infiniteRows = useMemo(
		() => infinite.data?.pages.flatMap((page) => page.items) ?? [],
		[infinite.data],
	);
	const infiniteTotal = infinite.data?.pages[0]?.total ?? 0;

	const columns = useMemo<ColumnDef<ViolationEntry>[]>(
		() => [
			{
				accessorKey: 'severity',
				header: t('views.violations.colSeverity'),
				size: 110,
				cell: (i) => i.getValue<string>(),
			},
			{
				accessorKey: 'validator',
				header: t('views.violations.colValidator'),
				size: 130,
				cell: (i) => i.getValue<string>(),
			},
			{
				accessorKey: 'rule',
				header: t('views.violations.colRule'),
				size: 180,
				cell: (i) => i.getValue<string>(),
			},
			{
				accessorKey: 'message',
				header: t('views.violations.colMessage'),
				size: 420,
				cell: (i) => i.getValue<string>(),
			},
			{
				accessorKey: 'url',
				header: t('views.violations.colUrl'),
				size: 320,
				cell: (i) => i.getValue<string>(),
			},
		],
		[t],
	);

	return (
		<div className="view">
			<ViewHeader
				titleKey="views.violations.title"
				descriptionKey="views.violations.description"
			/>
			<FilterBar>
				<input
					aria-label={t('views.violations.filterValidator')}
					placeholder={t('views.violations.filterValidator')}
					defaultValue={filter.validator ?? ''}
					onBlur={(e) => {
						update('validator', e.target.value);
					}}
				/>
				<input
					aria-label={t('views.violations.filterSeverity')}
					placeholder={t('views.violations.filterSeverity')}
					defaultValue={filter.severity ?? ''}
					onBlur={(e) => {
						update('severity', e.target.value);
					}}
				/>
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
