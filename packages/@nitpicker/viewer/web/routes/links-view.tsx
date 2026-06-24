import type { LinkRow, LinkType } from '../api/use-links-infinite.js';
import type { ColumnDef } from '@tanstack/react-table';

import { useEffect, useMemo } from 'react';

import { useLinksInfinite } from '../api/use-links-infinite.js';
import { usePagedQuery } from '../api/use-paged-query.js';
import { DataTable } from '../components/data-table.js';
import { FilterBar } from '../components/filter-bar.js';
import { ViewHeader } from '../components/view-header.js';
import { useListPagination } from '../hooks/use-list-pagination.js';
import { useUrlFilter } from '../hooks/use-url-filter.js';
import { useI18n } from '../i18n/use-i18n.js';

/** Valid link types for the selector. */
const LINK_TYPES: LinkType[] = ['broken', 'external'];

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
	const { params, update } = useUrlFilter();
	const { t } = useI18n();
	const { mode, pageSize, currentPage, setPage, setPageSize } = useListPagination();
	const rawType = params.get('type') as LinkType | null;
	const type: LinkType =
		rawType !== null && LINK_TYPES.includes(rawType) ? rawType : 'broken';

	// If the URL was visited with a now-removed `type` (e.g. a bookmarked
	// `?type=orphaned` from before the retirement of that filter), surface
	// the coercion in the URL bar so the shown rows stay consistent with
	// what the address says. Otherwise the table would render `broken`
	// rows under a `type=orphaned` URL — a silent data-meaning swap that
	// confuses sharing/handoff. `replace: true` keeps the back button from
	// returning the user to the just-corrected invalid URL.
	useEffect(() => {
		if (rawType !== null && !LINK_TYPES.includes(rawType)) {
			update('type', type, { replace: true });
		}
	}, [rawType, type, update]);

	const offset = (currentPage - 1) * pageSize;
	const paged = usePagedQuery<LinkRow>(
		'/api/links',
		{ type, limit: pageSize, offset },
		['links-paged', type, pageSize, currentPage],
		{ enabled: mode === 'mpa' },
	);
	const infinite = useLinksInfinite(type, { enabled: mode === 'virtual' });
	const infiniteRows = useMemo(
		() => infinite.data?.pages.flatMap((page) => page.items) ?? [],
		[infinite.data],
	);
	const infiniteTotal = infinite.data?.pages[0]?.total ?? 0;

	const columns = useMemo<ColumnDef<LinkRow>[]>(
		() => [
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
		[t],
	);

	return (
		<div className="view">
			<ViewHeader titleKey="views.links.title" descriptionKey="views.links.description" />
			<FilterBar>
				<select
					aria-label={t('common.type')}
					value={type}
					onChange={(e) => {
						update('type', e.target.value);
					}}>
					{LINK_TYPES.map((linkType) => (
						<option key={linkType} value={linkType}>
							{t(`views.links.${linkType}`)}
						</option>
					))}
				</select>
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
