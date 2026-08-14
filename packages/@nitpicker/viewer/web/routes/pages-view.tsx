import type { CellContext, ColumnDef, PagesFilter } from '../types.js';
import type { PageListFacets, PageListItem } from '@nitpicker/query';
import type { ContentTypeCategory } from '@nitpicker/query/categories';
import type { HeaderPresence } from '@nitpicker/query/header-presence';

import { CONTENT_TYPE_CATEGORIES } from '@nitpicker/query/categories';
import { HEADER_PRESENCE_KEYS } from '@nitpicker/query/header-presence';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';

import { useDedupeCapEvents } from '../api/use-dedupe-cap-events.js';
import { usePagedQuery } from '../api/use-paged-query.js';
import { usePagesInfinite } from '../api/use-pages-infinite.js';
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
 * Renders a string/number cell value, or an em dash when null/undefined.
 * @param info - The TanStack cell context.
 * @returns The display value.
 */
function textCell(info: CellContext<PageListItem, unknown>) {
	return info.getValue<string | number | null>() ?? '—';
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
 * pages only by default; check "External" in the Scope filter to include
 * them too. Columns are ordered to match the google-sheets "Page List" sheet.
 * @returns The pages view element.
 */
export function PagesView() {
	const { params, updateMany } = useUrlFilter();
	const navigate = useNavigate();
	const { t } = useI18n();
	const { mode, pageSize, currentPage, setPage, setPageSize } = useListPagination();

	// URL omits `isExternal` entirely (fresh visit, no filter applied yet) ->
	// default to internal-only, matching this view's historical default scope.
	// Once the key is present — even as an explicitly empty selection — the
	// URL always wins (see `addChecklistFilter`'s `defaultValues` doc).
	const isExternal = useMemo(
		() => (params.has('isExternal') ? params.getAll('isExternal') : ['false']),
		[params],
	);
	const status = params.getAll('status');
	const contentTypeCategory = params
		.getAll('contentTypeCategory')
		.filter((value): value is ContentTypeCategory =>
			(CONTENT_TYPE_CATEGORIES as readonly string[]).includes(value),
		);
	const templateKey = params.getAll('templateKey');
	const lang = params.getAll('lang');
	const missingTitle = params.getAll('missingTitle');
	const hasCSP = params.getAll('hasCSP');
	const hasXFrameOptions = params.getAll('hasXFrameOptions');
	const hasXContentTypeOptions = params.getAll('hasXContentTypeOptions');
	const hasHSTS = params.getAll('hasHSTS');
	const isDedupeCapped = params.getAll('isDedupeCapped');
	const dedupeCapEventIdParam = params.get('dedupeCapEventId');
	const parsedDedupeCapEventId = dedupeCapEventIdParam
		? Number(dedupeCapEventIdParam)
		: undefined;
	// A malformed/stale `?dedupeCapEventId=` (hand-edited URL, old bookmark)
	// must not reach the server as NaN — `toNumber` on the server throws on
	// NaN, which would take down the whole view. Treat it as "no filter"
	// instead, matching every other malformed-filter-value fallback here.
	const dedupeCapEventId = Number.isNaN(parsedDedupeCapEventId)
		? undefined
		: parsedDedupeCapEventId;
	const { data: dedupeCapEvents } = useDedupeCapEvents({
		enabled: dedupeCapEventId != null,
	});
	const dedupeCapEventShapeKey = dedupeCapEvents?.items.find(
		(event) => event.id === dedupeCapEventId,
	)?.shape_key;
	const filter: PagesFilter = {
		urlPattern: params.get('urlPattern') ?? undefined,
		directory: params.get('directory') ?? undefined,
		status,
		isExternal,
		lang,
		contentTypeCategory,
		missingTitle,
		hasCSP,
		hasXFrameOptions,
		hasXContentTypeOptions,
		hasHSTS,
		isDedupeCapped,
		dedupeCapEventId,
		templateKey,
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
				size: 110,
				cell: textCell,
			},
			{
				id: 'isExternal',
				header: 'Scope',
				size: 90,
				accessorFn: (row) =>
					row.isExternal ? t('common.external') : t('common.internal'),
			},
			{ accessorKey: 'lang', header: t('views.pages.colLang'), size: 90, cell: textCell },
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
			{
				accessorKey: 'mainContentSelector',
				header: 'main content selector',
				size: 200,
				cell: textCell,
			},
			{
				accessorKey: 'mainContentWordCount',
				header: '# main content words',
				size: 90,
				cell: textCell,
			},
			{
				accessorKey: 'mainContentBodyWordCount',
				header: '# body words',
				size: 90,
				cell: textCell,
			},
			{
				accessorKey: 'mainContentHeadingCount',
				header: '# headings',
				size: 80,
				cell: textCell,
			},
			{
				accessorKey: 'mainContentImageCount',
				header: '# main content images',
				size: 90,
				cell: textCell,
			},
			{
				accessorKey: 'mainContentTableCount',
				header: '# tables',
				size: 70,
				cell: textCell,
			},
			{
				accessorKey: 'mainContentButtonCount',
				header: '# buttons',
				size: 70,
				cell: textCell,
			},
			{
				accessorKey: 'mainContentIframeCount',
				header: '# iframes',
				size: 70,
				cell: textCell,
			},
			{
				accessorKey: 'mainContentVideoCount',
				header: '# videos',
				size: 70,
				cell: textCell,
			},
			{
				accessorKey: 'mainContentAudioCount',
				header: '# audios',
				size: 70,
				cell: textCell,
			},
			{
				accessorKey: 'mainContentCanvasCount',
				header: '# canvases',
				size: 70,
				cell: textCell,
			},
			{
				accessorKey: 'mainContentCustomElementCount',
				header: '# custom elements',
				size: 100,
				cell: textCell,
			},
			{
				accessorKey: 'scrollHeightDesktop',
				header: 'scroll height (desktop)',
				size: 130,
				cell: textCell,
			},
			{
				accessorKey: 'scrollHeightMobile',
				header: 'scroll height (mobile)',
				size: 130,
				cell: textCell,
			},
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
			{
				accessorKey: 'consoleErrorCount',
				header: t('views.pages.colConsoleErrorCount'),
				size: 160,
				cell: textCell,
			},
			{
				accessorKey: 'templateKey',
				header: t('views.pages.colTemplateKey'),
				size: 150,
				cell: textCell,
			},
			{
				accessorKey: 'isDedupeCapped',
				header: t('views.pages.filterDedupeCapped'),
				size: 190,
				cell: boolCell,
			},
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
			'mainContentWordCount',
			'mainContentBodyWordCount',
			'mainContentHeadingCount',
			'mainContentImageCount',
			'mainContentTableCount',
			'mainContentButtonCount',
			'mainContentIframeCount',
			'mainContentVideoCount',
			'mainContentAudioCount',
			'mainContentCanvasCount',
			'mainContentCustomElementCount',
			'scrollHeightDesktop',
			'scrollHeightMobile',
			'consoleErrorCount',
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
		addChecklistFilter(
			controls,
			{ params, updateMany },
			'status',
			'status',
			t('views.pages.colStatus'),
			(facets?.statuses ?? []).map((value) => ({
				value: String(value),
				label: String(value),
				checked: status.includes(String(value)),
			})),
		);
		addChecklistFilter(
			controls,
			{ params, updateMany },
			'isExternal',
			'isExternal',
			'Scope',
			(facets?.types ?? []).map((value) => ({
				value: String(value),
				label: value ? t('common.external') : t('common.internal'),
				checked: isExternal.includes(String(value)),
			})),
			['false'],
		);
		addChecklistFilter(
			controls,
			{ params, updateMany },
			'lang',
			'lang',
			t('views.pages.colLang'),
			(facets?.langs ?? []).map((value) => ({
				value,
				label: value,
				checked: lang.includes(value),
			})),
		);
		addChecklistFilter(
			controls,
			{ params, updateMany },
			'contentType',
			'contentTypeCategory',
			t('views.pages.filterContentType'),
			CONTENT_TYPE_CATEGORIES.map((category) => ({
				value: category,
				label: t(`views.contentType.${category}` as const),
				checked: contentTypeCategory.includes(category),
			})),
		);
		addChecklistFilter(
			controls,
			{ params, updateMany },
			'title',
			'missingTitle',
			t('views.pages.filterMissingTitle'),
			[
				{
					value: 'true',
					label: t('views.pages.filterMissingTitle'),
					checked: missingTitle.includes('true'),
				},
				{
					value: 'false',
					label: t('common.present'),
					checked: missingTitle.includes('false'),
				},
			],
		);
		const headerPresenceValues: Record<keyof HeaderPresence, readonly string[]> = {
			hasCSP,
			hasXFrameOptions,
			hasXContentTypeOptions,
			hasHSTS,
		};
		for (const key of HEADER_PRESENCE_KEYS) {
			addSort(controls, { params, updateMany }, key, key);
			addChecklistFilter(
				controls,
				{ params, updateMany },
				key,
				key,
				HEADER_PRESENCE_LABELS[key],
				[
					{
						value: 'true',
						label: t('common.yes'),
						checked: headerPresenceValues[key].includes('true'),
					},
					{
						value: 'false',
						label: t('common.none'),
						checked: headerPresenceValues[key].includes('false'),
					},
				],
			);
		}
		addChecklistFilter(
			controls,
			{ params, updateMany },
			'templateKey',
			'templateKey',
			t('views.pages.colTemplateKey'),
			(facets?.templateKeys ?? []).map((value) => ({
				value,
				label: value,
				checked: templateKey.includes(value),
			})),
		);
		addChecklistFilter(
			controls,
			{ params, updateMany },
			'isDedupeCapped',
			'isDedupeCapped',
			t('views.pages.filterDedupeCapped'),
			[
				{
					value: 'true',
					label: t('common.yes'),
					checked: isDedupeCapped.includes('true'),
				},
				{
					value: 'false',
					label: t('common.none'),
					checked: isDedupeCapped.includes('false'),
				},
			],
		);
		return controls;
	}, [
		contentTypeCategory,
		facets?.langs,
		facets?.statuses,
		facets?.templateKeys,
		facets?.types,
		hasCSP,
		hasHSTS,
		hasXContentTypeOptions,
		hasXFrameOptions,
		isDedupeCapped,
		isExternal,
		lang,
		missingTitle,
		params,
		status,
		t,
		templateKey,
		updateMany,
	]);

	return (
		<div className="view">
			<ViewHeader titleKey="views.pages.title" descriptionKey="views.pages.description" />
			{filter.directory && (
				<p className="filter-notice">
					{t('views.pages.directoryFilterNotice', { directory: filter.directory })}
				</p>
			)}
			{dedupeCapEventId != null && dedupeCapEventShapeKey && (
				<p className="filter-notice">
					{t('views.pages.dedupeCapEventFilterNotice', {
						shapeKey: dedupeCapEventShapeKey,
					})}
				</p>
			)}
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
