import type { PagesFilter } from '../types.js';
import type { PageListItem } from '@nitpicker/query';
import type { ContentTypeCategory } from '@nitpicker/query/categories';
import type { CellContext, ColumnDef } from '@tanstack/react-table';

import { CONTENT_TYPE_CATEGORIES } from '@nitpicker/query/categories';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';

import { usePagedQuery } from '../api/use-paged-query.js';
import { usePagesInfinite } from '../api/use-pages-infinite.js';
import { DataTable } from '../components/data-table.js';
import { FilterBar } from '../components/filter-bar.js';
import { ViewHeader } from '../components/view-header.js';
import { useListPagination } from '../hooks/use-list-pagination.js';
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
 * The page list: a filterable, sortable table backed by the user's chosen
 * pagination mode (MPA `?page=` by default, opt-in virtual scroll). Internal
 * pages only by default; check "Include external" to show all. Columns are
 * ordered to match the google-sheets "Page List" sheet.
 * @returns The pages view element.
 */
export function PagesView() {
	const { params, update } = useUrlFilter();
	const navigate = useNavigate();
	const { t } = useI18n();
	const { mode, pageSize, currentPage, setPage, setPageSize } = useListPagination();

	const includeExternal = params.get('includeExternal') === 'true';
	const contentTypeParam = params.get('contentTypeCategory');
	const contentTypeCategory: ContentTypeCategory | undefined =
		contentTypeParam &&
		(CONTENT_TYPE_CATEGORIES as readonly string[]).includes(contentTypeParam)
			? (contentTypeParam as ContentTypeCategory)
			: undefined;
	const filter: PagesFilter = {
		urlPattern: params.get('urlPattern') ?? undefined,
		isExternal: includeExternal ? undefined : false,
		contentTypeCategory,
		missingTitle: params.get('missingTitle') === 'true' ? true : undefined,
		sortBy: (params.get('sortBy') as PagesFilter['sortBy']) || undefined,
		sortOrder: (params.get('sortOrder') as PagesFilter['sortOrder']) || undefined,
	};

	const offset = (currentPage - 1) * pageSize;
	const paged = usePagedQuery<PageListItem>(
		'/api/pages',
		{ ...filter, limit: pageSize, offset },
		['pages-paged', filter, pageSize, currentPage],
		{ enabled: mode === 'mpa' },
	);
	const infinite = usePagesInfinite(filter, { enabled: mode === 'virtual' });

	const infiniteRows = useMemo(
		() => infinite.data?.pages.flatMap((page) => page.items) ?? [],
		[infinite.data],
	);
	const pagedTotal = paged.data?.total ?? 0;
	const infiniteTotal = infinite.data?.pages[0]?.total ?? 0;

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
			{ accessorKey: 'ogImageAlt', header: 'og:image:alt', size: 200, cell: textCell },
			{ accessorKey: 'ogLocale', header: 'og:locale', size: 100, cell: textCell },
			{
				accessorKey: 'ogArticlePublishedTime',
				header: 'og:article:published_time',
				size: 180,
				cell: textCell,
			},
			{ accessorKey: 'twitterSite', header: 'twitter:site', size: 140, cell: textCell },
			{
				accessorKey: 'twitterCreator',
				header: 'twitter:creator',
				size: 160,
				cell: textCell,
			},
			{ accessorKey: 'twitterImage', header: 'twitter:image', size: 240, cell: textCell },
			{ accessorKey: 'charset', header: 'charset', size: 80, cell: textCell },
			{ accessorKey: 'themeColor', header: 'theme-color', size: 100, cell: textCell },
			{ accessorKey: 'manifest', header: 'manifest', size: 240, cell: textCell },
			{ accessorKey: 'robotsRaw', header: 'robots:raw', size: 160, cell: textCell },
			{ accessorKey: 'tagCount', header: '# tags', size: 70, cell: textCell },
			{
				accessorKey: 'tagsProvidersCsv',
				header: 'tag providers',
				size: 240,
				cell: textCell,
			},
			{ accessorKey: 'jsonldCount', header: '# JSON-LD', size: 80, cell: textCell },
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
					aria-label={t('views.pages.filterContentType')}
					value={contentTypeCategory ?? ''}
					onChange={(e) => {
						update('contentTypeCategory', e.target.value);
					}}>
					<option value="">{t('views.pages.filterContentType')}</option>
					{CONTENT_TYPE_CATEGORIES.map((category) => (
						<option key={category} value={category}>
							{t(`views.contentType.${category}` as const)}
						</option>
					))}
				</select>
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
			{mode === 'mpa' ? (
				<DataTable
					mode="mpa"
					columns={columns}
					data={paged.data?.items ?? []}
					total={pagedTotal}
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
