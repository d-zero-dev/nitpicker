import type { ViolationEntry } from '../types.js';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { useViolationsInfinite } from '../api/use-violations-infinite.js';
import { FilterBar } from '../components/filter-bar.js';
import { ViewHeader } from '../components/view-header.js';
import { VirtualTable } from '../components/virtual-table.js';
import { useUrlFilter } from '../hooks/use-url-filter.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * The analysis violations view: a virtualized table of axe/markuplint/etc.
 * findings, filterable by validator and severity.
 * @returns The violations view element.
 */
export function ViolationsView() {
	const { params, update } = useUrlFilter();
	const { t } = useI18n();
	const filter = {
		validator: params.get('validator') ?? undefined,
		severity: params.get('severity') ?? undefined,
		rule: params.get('rule') ?? undefined,
	};

	const { data, fetchNextPage, hasNextPage, isFetching, isLoading } =
		useViolationsInfinite(filter);
	const rows = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
	const total = data?.pages[0]?.total ?? 0;

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
