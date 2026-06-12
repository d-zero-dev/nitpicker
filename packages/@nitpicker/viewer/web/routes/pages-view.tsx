import type { PagesFilter } from '../types.js';
import type { PageListItem } from '@nitpicker/query';
import type { CellContext, ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';
import { useNavigate } from 'react-router';

import { usePagesInfinite } from '../api/use-pages-infinite.js';
import { FilterBar } from '../components/filter-bar.js';
import { ViewHeader } from '../components/view-header.js';
import { VirtualTable } from '../components/virtual-table.js';
import { useUrlFilter } from '../hooks/use-url-filter.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * Renders a string/number cell value, or an em dash when null/undefined.
 * @param info - The TanStack cell context.
 * @returns The display value.
 */
function textCell(info: CellContext<PageListItem, unknown>) {
	return info.getValue<string | number | null>() ?? '—';
}

/**
 * The page list: a virtualized, filterable, sortable table backed by an
 * infinite query, with columns ordered to match the google-sheets "Page List"
 * sheet. Internal pages only by default; check "Include external" to show all.
 * @returns The pages view element.
 */
export function PagesView() {
	const { params, update } = useUrlFilter();
	const navigate = useNavigate();
	const { t } = useI18n();

	const includeExternal = params.get('includeExternal') === 'true';
	const filter: PagesFilter = {
		urlPattern: params.get('urlPattern') ?? undefined,
		isExternal: includeExternal ? undefined : false,
		missingTitle: params.get('missingTitle') === 'true' ? true : undefined,
		sortBy: (params.get('sortBy') as PagesFilter['sortBy']) || undefined,
		sortOrder: (params.get('sortOrder') as PagesFilter['sortOrder']) || undefined,
	};

	const { data, fetchNextPage, hasNextPage, isFetching, isLoading } =
		usePagesInfinite(filter);
	const rows = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
	const total = data?.pages[0]?.total ?? 0;

	const columns = useMemo<ColumnDef<PageListItem>[]>(() => {
		const boolCell = (info: CellContext<PageListItem, unknown>) =>
			info.getValue<boolean>() ? t('common.yes') : '';
		return [
			{
				accessorKey: 'title',
				header: t('views.pages.colTitle'),
				size: 240,
				cell: textCell,
			},
			{
				accessorKey: 'url',
				header: t('views.pages.colUrl'),
				size: 340,
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
				accessorKey: 'status',
				header: t('views.pages.colStatus'),
				size: 80,
				cell: textCell,
			},
			{ accessorKey: 'lang', header: t('views.pages.colLang'), size: 80, cell: textCell },
			{ accessorKey: 'description', header: 'description', size: 280, cell: textCell },
			{ accessorKey: 'keywords', header: 'keywords', size: 180, cell: textCell },
			{ accessorKey: 'noindex', header: 'noindex', size: 80, cell: boolCell },
			{ accessorKey: 'nofollow', header: 'nofollow', size: 80, cell: boolCell },
			{ accessorKey: 'noarchive', header: 'noarchive', size: 90, cell: boolCell },
			{ accessorKey: 'canonical', header: 'canonical', size: 280, cell: textCell },
			{ accessorKey: 'alternate', header: 'alternate', size: 200, cell: textCell },
			{ accessorKey: 'twitterCard', header: 'twitter:card', size: 120, cell: textCell },
			{ accessorKey: 'ogSiteName', header: 'og:site_name', size: 160, cell: textCell },
			{ accessorKey: 'ogUrl', header: 'og:url', size: 240, cell: textCell },
			{ accessorKey: 'ogTitle', header: 'og:title', size: 200, cell: textCell },
			{
				accessorKey: 'ogDescription',
				header: 'og:description',
				size: 280,
				cell: textCell,
			},
			{ accessorKey: 'ogType', header: 'og:type', size: 100, cell: textCell },
			{ accessorKey: 'ogImage', header: 'og:image', size: 240, cell: textCell },
		];
	}, [navigate, t]);

	return (
		<div className="view">
			<ViewHeader titleKey="views.pages.title" descriptionKey="views.pages.description" />
			<FilterBar>
				<input
					aria-label={t('views.pages.filterUrlPattern')}
					placeholder={t('views.pages.filterUrlPattern')}
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
				<label>
					<input
						type="checkbox"
						checked={filter.missingTitle ?? false}
						onChange={(e) => {
							update('missingTitle', e.target.checked ? 'true' : '');
						}}
					/>
					{t('views.pages.filterMissingTitle')}
				</label>
				<select
					aria-label={t('common.sort')}
					value={params.get('sortBy') ?? ''}
					onChange={(e) => {
						update('sortBy', e.target.value);
					}}>
					<option value="">{t('common.sort')}</option>
					<option value="url">{t('views.pages.colUrl')}</option>
					<option value="status">{t('views.pages.colStatus')}</option>
					<option value="title">{t('views.pages.colTitle')}</option>
				</select>
				<select
					aria-label={t('common.order')}
					value={params.get('sortOrder') ?? ''}
					onChange={(e) => {
						update('sortOrder', e.target.value);
					}}>
					<option value="">{t('common.order')}</option>
					<option value="asc">{t('common.asc')}</option>
					<option value="desc">{t('common.desc')}</option>
				</select>
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
