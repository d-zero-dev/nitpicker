import type { ColumnDef, ViolationEntry } from '../types.js';

import { useMemo } from 'react';

import { usePagedQuery } from '../api/use-paged-query.js';
import { useViolationsInfinite } from '../api/use-violations-infinite.js';
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
 * The analysis violations view: a table of axe/markuplint/etc. findings,
 * filterable by validator and severity. Rendered via the user's chosen
 * pagination mode.
 * @returns The violations view element.
 */
export function ViolationsView() {
	const { params, updateMany } = useUrlFilter();
	const { t } = useI18n();
	const { mode, pageSize, currentPage, setPage, setPageSize } = useListPagination();
	const filter = {
		validator: params.get('validator') ?? undefined,
		severity: params.getAll('severity'),
		rule: params.get('rule') ?? undefined,
		urlPattern: params.get('urlPattern') ?? undefined,
		sortBy: params.get('sortBy') ?? undefined,
		sortOrder: params.get('sortOrder') ?? undefined,
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
	const columnControls = useMemo(() => {
		const context = { params, updateMany };
		const controls = createTableControls(context);
		for (const key of ['severity', 'validator', 'rule', 'message', 'url']) {
			addSort(controls, context, key, key);
		}
		addChecklistFilter(
			controls,
			context,
			'severity',
			'severity',
			t('views.violations.filterSeverity'),
			[
				{ value: 'error', label: 'error' },
				{ value: 'warning', label: 'warning' },
				{ value: 'info', label: 'info' },
				{ value: 'minor', label: 'minor' },
				{ value: 'moderate', label: 'moderate' },
				{ value: 'serious', label: 'serious' },
				{ value: 'critical', label: 'critical' },
			],
		);
		addTextFilter(
			controls,
			context,
			'validator',
			'validator',
			t('views.violations.filterValidator'),
		);
		addTextFilter(controls, context, 'rule', 'rule', t('views.violations.colRule'));
		addTextFilter(
			controls,
			context,
			'url',
			'urlPattern',
			t('views.pages.filterUrlPattern'),
		);
		return controls;
	}, [params, t, updateMany]);

	return (
		<div className="view">
			<ViewHeader
				titleKey="views.violations.title"
				descriptionKey="views.violations.description"
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
