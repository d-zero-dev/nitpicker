import type { PagesFilter } from '../types.js';
import type { PageListFacets, PageListItem } from '@nitpicker/query';
import type { ContentTypeCategory } from '@nitpicker/query/categories';
import type { HeaderPresence } from '@nitpicker/query/header-presence';
import type { CellContext, ColumnDef } from '@tanstack/react-table';

import { CONTENT_TYPE_CATEGORIES } from '@nitpicker/query/categories';
import { HEADER_PRESENCE_KEYS } from '@nitpicker/query/header-presence';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';

import { usePagedQuery } from '../api/use-paged-query.js';
import { usePagesInfinite } from '../api/use-pages-infinite.js';
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
 * Renders a string/number cell value, or an em dash when null/undefined.
 * @param info - The TanStack cell context.
 * @returns The display value.
 */
function textCell(info: CellContext<PageListItem, unknown>) {
	return info.getValue<string | number | null>() ?? '—';
}

/**
 * Parses a `?hasCSP=` style URL param into a filter value.
 * @param value - The raw URL query param value.
 * @returns `true`/`false` for `'true'`/`'false'`, `undefined` otherwise (no filter).
 */
function parseHeaderFilterParam(value: string | null): boolean | undefined {
	if (value === 'true') return true;
	if (value === 'false') return false;
	return undefined;
}

/**
 * Human-readable labels for the tracked security headers, keyed by
 * {@link HeaderPresence} field name. These are the conventional protocol
 * names (not translated) — the same convention already used for these
 * headers' column headers in this table.
 */
const HEADER_PRESENCE_LABELS: Record<keyof HeaderPresence, string> = {
	hasCSP: 'CSP',
	hasXFrameOptions: 'X-Frame-Options',
	hasXContentTypeOptions: 'X-Content-Type-Options',
	hasHSTS: 'HSTS',
};

/**
 * The page list: a filterable, sortable table backed by the user's chosen
 * pagination mode (MPA `?page=` by default, opt-in virtual scroll). Internal
 * pages only by default; check "Include external" to show all. Columns are
 * ordered to match the google-sheets "Page List" sheet.
 * @returns The pages view element.
 */
export function PagesView() {
	const { params, updateMany } = useUrlFilter();
	const navigate = useNavigate();
	const { t } = useI18n();
	const { mode, pageSize, currentPage, setPage, setPageSize } = useListPagination();

	const scope = params.get('isExternal') ?? 'false';
	const status = params.get('status');
	const statusValue = status == null ? undefined : Number(status);
	const contentTypeParam = params.get('contentTypeCategory');
	const contentTypeCategory: ContentTypeCategory | undefined =
		contentTypeParam &&
		(CONTENT_TYPE_CATEGORIES as readonly string[]).includes(contentTypeParam)
			? (contentTypeParam as ContentTypeCategory)
			: undefined;
	const filter: PagesFilter = {
		urlPattern: params.get('urlPattern') ?? undefined,
		status: Number.isFinite(statusValue) ? statusValue : undefined,
		isExternal: scope === 'all' ? undefined : scope === 'true',
		lang: params.get('lang') ?? undefined,
		contentTypeCategory,
		missingTitle: params.get('missingTitle') === 'true' ? true : undefined,
		hasCSP: parseHeaderFilterParam(params.get('hasCSP')),
		hasXFrameOptions: parseHeaderFilterParam(params.get('hasXFrameOptions')),
		hasXContentTypeOptions: parseHeaderFilterParam(params.get('hasXContentTypeOptions')),
		hasHSTS: parseHeaderFilterParam(params.get('hasHSTS')),
		sortBy: (params.get('sortBy') as PagesFilter['sortBy']) || 'url',
		sortOrder: (params.get('sortOrder') as PagesFilter['sortOrder']) || 'asc',
	};

	const offset = (currentPage - 1) * pageSize;
	const paged = usePagedQuery<PageListItem, PageListFacets>(
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
	const facets = paged.data?.facets;

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
			{
				id: 'isExternal',
				header: 'Scope',
				size: 90,
				accessorFn: (row) =>
					row.isExternal ? t('common.external') : t('common.internal'),
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
			{ accessorKey: 'hasCSP', header: 'CSP', size: 70, cell: boolCell },
			{
				accessorKey: 'hasXFrameOptions',
				header: 'X-Frame-Options',
				size: 130,
				cell: boolCell,
			},
			{
				accessorKey: 'hasXContentTypeOptions',
				header: 'X-Content-Type-Options',
				size: 170,
				cell: boolCell,
			},
			{ accessorKey: 'hasHSTS', header: 'HSTS', size: 70, cell: boolCell },
		];
	}, [navigate, t]);
	const columnControls = useMemo(() => {
		const controls = createTableControls({ params, updateMany });
		for (const key of [
			'title',
			'status',
			'contentType',
			'lang',
			'description',
			'keywords',
			'noindex',
			'nofollow',
			'noarchive',
			'canonical',
			'tagCount',
			'jsonldCount',
		]) {
			addSort(controls, { params, updateMany }, key, key);
		}
		addSort(controls, { params, updateMany }, 'url', 'url', 'asc');
		addTextFilter(
			controls,
			{ params, updateMany },
			'url',
			'urlPattern',
			t('views.pages.filterUrlPattern'),
		);
		addRadioFilter(
			controls,
			{ params, updateMany },
			'status',
			'status',
			t('views.pages.colStatus'),
			[
				{ value: '', label: t('common.all'), checked: !status },
				...(facets?.statuses ?? []).map((value) => ({
					value: String(value),
					label: String(value),
					checked: status === String(value),
				})),
			],
		);
		addRadioFilter(
			controls,
			{ params, updateMany },
			'isExternal',
			'isExternal',
			'Scope',
			[
				{ value: 'all', label: t('common.all'), checked: scope === 'all' },
				...(facets?.types ?? []).map((value) => ({
					value: String(value),
					label: value ? t('common.external') : t('common.internal'),
					checked:
						(scope !== 'all' && scope !== 'true' && !value) || scope === String(value),
				})),
			],
		);
		addRadioFilter(
			controls,
			{ params, updateMany },
			'lang',
			'lang',
			t('views.pages.colLang'),
			[
				{ value: '', label: t('common.all'), checked: !filter.lang },
				...(facets?.langs ?? []).map((value) => ({
					value,
					label: value,
					checked: filter.lang === value,
				})),
			],
		);
		addRadioFilter(
			controls,
			{ params, updateMany },
			'contentType',
			'contentTypeCategory',
			t('views.pages.filterContentType'),
			[
				{ value: '', label: t('common.all'), checked: !contentTypeCategory },
				...CONTENT_TYPE_CATEGORIES.map((category) => ({
					value: category,
					label: t(`views.contentType.${category}` as const),
					checked: contentTypeCategory === category,
				})),
			],
		);
		addRadioFilter(
			controls,
			{ params, updateMany },
			'title',
			'missingTitle',
			t('views.pages.filterMissingTitle'),
			[
				{ value: '', label: t('common.all'), checked: !filter.missingTitle },
				{
					value: 'true',
					label: t('views.pages.filterMissingTitle'),
					checked: !!filter.missingTitle,
				},
			],
		);
		const headerPresenceFilter: Record<keyof HeaderPresence, boolean | undefined> = {
			hasCSP: filter.hasCSP,
			hasXFrameOptions: filter.hasXFrameOptions,
			hasXContentTypeOptions: filter.hasXContentTypeOptions,
			hasHSTS: filter.hasHSTS,
		};
		for (const key of HEADER_PRESENCE_KEYS) {
			addSort(controls, { params, updateMany }, key, key);
			addRadioFilter(
				controls,
				{ params, updateMany },
				key,
				key,
				HEADER_PRESENCE_LABELS[key],
				[
					{
						value: '',
						label: t('common.all'),
						checked: headerPresenceFilter[key] == null,
					},
					{
						value: 'true',
						label: t('common.yes'),
						checked: headerPresenceFilter[key] === true,
					},
					{
						value: 'false',
						label: t('common.none'),
						checked: headerPresenceFilter[key] === false,
					},
				],
			);
		}
		return controls;
	}, [
		contentTypeCategory,
		facets?.langs,
		facets?.statuses,
		facets?.types,
		filter.hasCSP,
		filter.hasHSTS,
		filter.hasXContentTypeOptions,
		filter.hasXFrameOptions,
		filter.lang,
		filter.missingTitle,
		params,
		scope,
		status,
		t,
		updateMany,
	]);

	return (
		<div className="view">
			<ViewHeader titleKey="views.pages.title" descriptionKey="views.pages.description" />
			{mode === 'mpa' ? (
				<DataTable
					mode="mpa"
					columns={columns}
					columnControls={columnControls}
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
