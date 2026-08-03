import type { MismatchType } from '../api/use-mismatches.js';
import type { MismatchEntry } from '@nitpicker/query';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { usePagedQuery } from '../api/use-paged-query.js';
import {
	addChecklistFilter,
	addSort,
	addTextFilter,
	createTableControls,
} from '../components/create-table-controls.js';
import { DataTable } from '../components/data-table.js';
import { DiffCell } from '../components/diff-cell.js';
import { ViewHeader } from '../components/view-header.js';
import { useListPagination } from '../hooks/use-list-pagination.js';
import { useUrlFilter } from '../hooks/use-url-filter.js';
import { useI18n } from '../i18n/use-i18n.js';
import { diffText } from '../utils/diff-text.js';

/** Selectable mismatch types (technical terms, shown verbatim). */
const MISMATCH_TYPES: MismatchType[] = ['canonical', 'og:title', 'og:description'];

/**
 * The mismatches view: pages whose canonical / og:title / og:description
 * disagree with their actual values, shown as a red/green character diff.
 * @returns The mismatches view element.
 */
export function MismatchesView() {
	const { params, updateMany } = useUrlFilter();
	const { t } = useI18n();
	const type = params.getAll('type') as MismatchType[];
	const { pageSize, currentPage, setPage, setPageSize } = useListPagination();
	const offset = (currentPage - 1) * pageSize;
	const filter = {
		type,
		urlPattern: params.get('urlPattern') ?? undefined,
		sortBy: params.get('sortBy') ?? undefined,
		sortOrder: params.get('sortOrder') ?? undefined,
	};
	const paged = usePagedQuery<MismatchEntry>(
		'/api/mismatches',
		{ ...filter, limit: pageSize, offset },
		['mismatches-paged', filter, pageSize, currentPage],
	);
	const rows = paged.data?.items ?? [];
	const columns = useMemo<ColumnDef<MismatchEntry>[]>(
		() => [
			{
				accessorKey: 'type',
				header: t('common.type'),
				size: 140,
			},
			{
				accessorKey: 'url',
				header: t('views.mismatches.colUrl'),
				size: 360,
			},
			{
				accessorKey: 'actual',
				header: t('views.mismatches.actual'),
				size: 260,
				cell: (info) => {
					const row = info.row.original;
					return (
						<DiffCell segments={diffText(row.actual ?? '', row.expected ?? '').actual} />
					);
				},
			},
			{
				accessorKey: 'expected',
				header: t('views.mismatches.expected'),
				size: 260,
				cell: (info) => {
					const row = info.row.original;
					return (
						<DiffCell
							segments={diffText(row.actual ?? '', row.expected ?? '').expected}
						/>
					);
				},
			},
		],
		[t],
	);
	const columnControls = useMemo(() => {
		const context = { params, updateMany };
		const controls = createTableControls(context);
		for (const key of ['url', 'actual', 'expected']) {
			addSort(controls, context, key, key);
		}
		addChecklistFilter(
			controls,
			context,
			'type',
			'type',
			t('common.type'),
			MISMATCH_TYPES.map((value) => ({ value, label: value })),
		);
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
				titleKey="views.mismatches.title"
				descriptionKey="views.mismatches.description"
			/>
			<DataTable
				mode="mpa"
				columns={columns}
				data={rows}
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
