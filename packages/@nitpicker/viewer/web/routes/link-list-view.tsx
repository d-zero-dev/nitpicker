import type { LinkRow, LinkType } from '../api/use-links-infinite.js';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { useLinksInfinite } from '../api/use-links-infinite.js';
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
 * Props for {@link LinkListView}.
 */
interface LinkListViewProps {
	/** Which link analysis this instance renders. */
	type: LinkType;
	/** i18n dot-path for the view title. */
	titleKey: string;
	/** i18n dot-path for the view description. */
	descriptionKey: string;
	/** i18n dot-path prefix for the column labels (`${prefix}.colSource` etc.). */
	i18nPrefix: string;
}

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
 * Shared table for the broken-links and external-links views: same columns
 * (source / destination / status) and controls, differing only in the fixed
 * `type` sent to `/api/links` and the i18n copy. Rendered via the user's
 * chosen pagination mode.
 * @param props - See {@link LinkListViewProps}.
 * @param props.type
 * @param props.titleKey
 * @param props.descriptionKey
 * @param props.i18nPrefix
 * @returns The link-list view element.
 */
export function LinkListView({
	type,
	titleKey,
	descriptionKey,
	i18nPrefix,
}: LinkListViewProps) {
	const { params, updateMany } = useUrlFilter();
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
	const paged = usePagedQuery<LinkRow>(
		'/api/links',
		{ type, ...filter, limit: pageSize, offset },
		[`${type}-links-paged`, filter, pageSize, currentPage],
		{ enabled: mode === 'mpa' },
	);
	const infinite = useLinksInfinite(type, filter, { enabled: mode === 'virtual' });
	const infiniteRows = useMemo(
		() => infinite.data?.pages.flatMap((page) => page.items) ?? [],
		[infinite.data],
	);
	const infiniteTotal = infinite.data?.pages[0]?.total ?? 0;

	const columns = useMemo<ColumnDef<LinkRow>[]>(
		() => [
			{
				id: 'sourceUrl',
				header: t(`${i18nPrefix}.colSource`),
				size: 380,
				accessorFn: (r) => field(r, 'sourceUrl'),
			},
			{
				id: 'destUrl',
				header: t(`${i18nPrefix}.colDest`),
				size: 380,
				accessorFn: (r) => field(r, 'destUrl'),
			},
			{
				id: 'status',
				header: t(`${i18nPrefix}.colStatus`),
				size: 90,
				accessorFn: (r) => field(r, 'status') || '—',
			},
		],
		[i18nPrefix, t],
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
		addRadioFilter(
			controls,
			context,
			'status',
			'status',
			t(`${i18nPrefix}.colStatus`),
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
			'destUrl',
			'urlPattern',
			t('views.pages.filterUrlPattern'),
		);
		return controls;
	}, [i18nPrefix, paged.data?.items, params, status, t, updateMany]);

	return (
		<div className="view">
			<ViewHeader titleKey={titleKey} descriptionKey={descriptionKey} />
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
