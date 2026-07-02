import type { LinkRow, LinkType } from '../api/use-links-infinite.js';
import type { ColumnDef } from '@tanstack/react-table';

import { useEffect, useMemo } from 'react';

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

/** Valid link types for the selector. */
const LINK_TYPES = new Set<LinkType>(['broken', 'external']);

/**
 * Reads a string property from a link row.
 * @param row - The link row.
 * @param key - The property name.
 * @returns The stringified value, or an empty string if absent.
 */
function field(row: LinkRow, key: string): string {
	const value = (row as Record<string, unknown>)[key];
	return value == null ? '' : String(value);
}

/**
 * The link analysis view: broken or external links, rendered via the user's
 * chosen pagination mode.
 *
 * The previous `'orphaned'` chip was retired together with `listLinks
 * type:'orphaned'`. Complete singleton inventory-* pages now live in the
 * **孤立ページ** view, and interconnected orphan groups in the **孤立集合**
 * view — the two well-separated concepts that the old single `'orphaned'`
 * bucket conflated.
 * @returns The links view element.
 */
export function LinksView() {
	const { params, update, updateMany } = useUrlFilter();
	const { t } = useI18n();
	const { mode, pageSize, currentPage, setPage, setPageSize } = useListPagination();
	const rawType = params.get('type') as LinkType | null;
	const type: LinkType = rawType !== null && LINK_TYPES.has(rawType) ? rawType : 'broken';
	const status = params.get('status');
	const statusValue = status == null ? undefined : Number(status);
	const filter = {
		urlPattern: params.get('urlPattern') ?? undefined,
		status: Number.isFinite(statusValue) ? statusValue : undefined,
		sortBy: params.get('sortBy') ?? undefined,
		sortOrder: params.get('sortOrder') ?? undefined,
	};

	// If the URL was visited with a now-removed `type` (e.g. a bookmarked
	// `?type=orphaned` from before the retirement of that filter), surface
	// the coercion in the URL bar so the shown rows stay consistent with
	// what the address says. Otherwise the table would render `broken`
	// rows under a `type=orphaned` URL — a silent data-meaning swap that
	// confuses sharing/handoff. `replace: true` keeps the back button from
	// returning the user to the just-corrected invalid URL.
	useEffect(() => {
		if (rawType !== null && !LINK_TYPES.has(rawType)) {
			update('type', type, { replace: true });
		}
	}, [rawType, type, update]);

	const offset = (currentPage - 1) * pageSize;
	const paged = usePagedQuery<LinkRow>(
		'/api/links',
		{
			type,
			...filter,
			limit: pageSize,
			offset,
		},
		['links-paged', type, params.toString(), pageSize, currentPage],
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
				id: 'type',
				header: t('common.type'),
				size: 110,
				accessorFn: () => t(`views.links.${type}`),
			},
			{
				id: 'sourceUrl',
				header: t('views.links.colSource'),
				size: 380,
				accessorFn: (r) => field(r, 'sourceUrl'),
			},
			{
				id: 'destUrl',
				header: t('views.links.colDest'),
				size: 380,
				accessorFn: (r) => field(r, 'destUrl'),
			},
			{
				id: 'status',
				header: t('views.links.colStatus'),
				size: 90,
				accessorFn: (r) => field(r, 'status') || '—',
			},
		],
		[t, type],
	);
	const columnControls = useMemo(() => {
		const context = { params, updateMany };
		const controls = createTableControls(context);
		for (const key of ['sourceUrl', 'destUrl', 'status']) {
			addSort(controls, context, key, key);
		}
		addRadioFilter(
			controls,
			context,
			'type',
			'type',
			t('common.type'),
			[
				{ value: 'broken', label: t('views.links.broken'), checked: false },
				{ value: 'external', label: t('views.links.external'), checked: false },
			],
			'broken',
		);
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
			t('views.links.colStatus'),
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
	}, [paged.data?.items, params, status, t, updateMany]);

	return (
		<div className="view">
			<ViewHeader titleKey="views.links.title" descriptionKey="views.links.description" />
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
