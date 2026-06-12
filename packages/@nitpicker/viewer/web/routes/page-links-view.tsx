import type { PageLinkEntry } from '@nitpicker/query';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';
import { useNavigate } from 'react-router';

import { usePageLinksInfinite } from '../api/use-page-links-infinite.js';
import { FilterBar } from '../components/filter-bar.js';
import { ViewHeader } from '../components/view-header.js';
import { VirtualTable } from '../components/virtual-table.js';
import { useUrlFilter } from '../hooks/use-url-filter.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * The page-links view: one row per page (google-sheets "Links" sheet) with
 * status, redirect-from / referrer counts, header presence, and remarks.
 * @returns The page-links view element.
 */
export function PageLinksView() {
	const { params, update } = useUrlFilter();
	const navigate = useNavigate();
	const { t } = useI18n();
	const includeExternal = params.get('includeExternal') === 'true';
	const filter = {
		isExternal: includeExternal ? undefined : false,
		urlPattern: params.get('urlPattern') ?? undefined,
	};

	const { data, fetchNextPage, hasNextPage, isFetching, isLoading } =
		usePageLinksInfinite(filter);
	const rows = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
	const total = data?.pages[0]?.total ?? 0;

	const columns = useMemo<ColumnDef<PageLinkEntry>[]>(
		() => [
			{
				accessorKey: 'url',
				header: t('views.pageLinks.colUrl'),
				size: 360,
				cell: (info) => (
					<button
						type="button"
						className="link-button"
						onClick={() => {
							void navigate(
								`/pages/detail?url=${encodeURIComponent(info.row.original.url)}`,
							);
						}}>
						{info.getValue<string>()}
					</button>
				),
			},
			{
				accessorKey: 'title',
				header: t('views.pageLinks.colTitle'),
				size: 220,
				cell: (i) => i.getValue<string | null>() ?? '—',
			},
			{
				accessorKey: 'status',
				header: t('views.pageLinks.colStatus'),
				size: 80,
				cell: (i) => i.getValue<number | null>() ?? '—',
			},
			{
				accessorKey: 'statusText',
				header: t('views.pageLinks.colStatusText'),
				size: 110,
				cell: (i) => i.getValue<string | null>() ?? '—',
			},
			{
				accessorKey: 'contentType',
				header: t('views.pageLinks.colType'),
				size: 150,
				cell: (i) => i.getValue<string | null>() ?? '—',
			},
			{
				accessorKey: 'redirectFromCount',
				header: t('views.pageLinks.colRedirectFrom'),
				size: 110,
				cell: (i) => i.getValue<number>(),
			},
			{
				accessorKey: 'referrerCount',
				header: t('views.pageLinks.colReferrers'),
				size: 100,
				cell: (i) => i.getValue<number>(),
			},
			{
				accessorKey: 'hasResponseHeaders',
				header: t('views.pageLinks.colHeaders'),
				size: 90,
				cell: (i) => (i.getValue<boolean>() ? t('common.yes') : ''),
			},
			{
				accessorKey: 'skipReason',
				header: t('views.pageLinks.colRemarks'),
				size: 160,
				cell: (i) => i.getValue<string | null>() ?? '',
			},
		],
		[navigate, t],
	);

	return (
		<div className="view">
			<ViewHeader
				titleKey="views.pageLinks.title"
				descriptionKey="views.pageLinks.description"
			/>
			<FilterBar>
				<input
					aria-label={t('views.pageLinks.filterUrlPattern')}
					placeholder={t('views.pageLinks.filterUrlPattern')}
					defaultValue={filter.urlPattern ?? ''}
					onBlur={(e) => {
						update('urlPattern', e.target.value);
					}}
				/>
				<label>
					<input
						type="checkbox"
						checked={includeExternal}
						onChange={(e) => {
							update('includeExternal', e.target.checked ? 'true' : '');
						}}
					/>
					{t('common.includeExternal')}
				</label>
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
