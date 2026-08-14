import type { ColumnDef } from '../types.js';
import type { ImageEntry } from '@nitpicker/query';

import { useMemo } from 'react';

import { useImagesInfinite } from '../api/use-images-infinite.js';
import { usePagedQuery } from '../api/use-paged-query.js';
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
 * The image list: a table for spotting missing alt text, missing dimensions,
 * and oversized images, rendered via the user's chosen pagination mode.
 * Includes a thumbnail preview column.
 * @returns The images view element.
 */
export function ImagesView() {
	const { params, updateMany } = useUrlFilter();
	const { t } = useI18n();
	const { mode, pageSize, currentPage, setPage, setPageSize } = useListPagination();
	const missingAlt = params.getAll('missingAlt');
	const missingDimensions = params.getAll('missingDimensions');
	const filter = {
		missingAlt,
		missingDimensions,
		urlPattern: params.get('urlPattern') ?? undefined,
		sortBy: params.get('sortBy') ?? undefined,
		sortOrder: params.get('sortOrder') ?? undefined,
	};

	const offset = (currentPage - 1) * pageSize;
	const paged = usePagedQuery<ImageEntry>(
		'/api/images',
		{ ...filter, limit: pageSize, offset },
		['images-paged', filter, pageSize, currentPage],
		{ enabled: mode === 'mpa' },
	);
	const infinite = useImagesInfinite(filter, { enabled: mode === 'virtual' });
	const infiniteRows = useMemo(
		() => infinite.data?.pages.flatMap((page) => page.items) ?? [],
		[infinite.data],
	);
	const infiniteTotal = infinite.data?.pages[0]?.total ?? 0;

	const columns = useMemo<ColumnDef<ImageEntry>[]>(
		() => [
			{
				id: 'preview',
				header: t('views.images.colPreview'),
				size: 70,
				enableResizing: false,
				cell: (info) => {
					const src = info.row.original.src;
					return src ? (
						<img className="img-preview" src={src} alt="" loading="lazy" />
					) : (
						'—'
					);
				},
			},
			{
				accessorKey: 'src',
				header: t('views.images.colSrc'),
				size: 360,
				cell: (i) => i.getValue<string | null>() ?? '—',
			},
			{
				accessorKey: 'alt',
				header: t('views.images.colAlt'),
				size: 200,
				cell: (i) => i.getValue<string | null>() ?? '—',
			},
			{
				id: 'natural',
				header: t('views.images.colNatural'),
				size: 110,
				accessorFn: (row) => `${row.naturalWidth}×${row.naturalHeight}`,
			},
			{
				accessorKey: 'pageUrl',
				header: t('views.images.colPage'),
				size: 320,
				cell: (i) => i.getValue<string>(),
			},
		],
		[t],
	);
	const columnControls = useMemo(() => {
		const context = { params, updateMany };
		const controls = createTableControls(context);
		for (const key of ['src', 'alt', 'pageUrl']) {
			addSort(controls, context, key, key);
		}
		addSort(controls, context, 'natural', 'naturalWidth');
		addTextFilter(
			controls,
			context,
			'src',
			'urlPattern',
			t('views.images.filterUrlPattern'),
		);
		addChecklistFilter(
			controls,
			context,
			'alt',
			'missingAlt',
			t('views.images.filterMissingAlt'),
			[
				{
					value: 'true',
					label: t('views.images.filterMissingAlt'),
					checked: missingAlt.includes('true'),
				},
				{
					value: 'false',
					label: t('common.present'),
					checked: missingAlt.includes('false'),
				},
			],
		);
		addChecklistFilter(
			controls,
			context,
			'natural',
			'missingDimensions',
			t('views.images.filterMissingDimensions'),
			[
				{
					value: 'true',
					label: t('views.images.filterMissingDimensions'),
					checked: missingDimensions.includes('true'),
				},
				{
					value: 'false',
					label: t('common.present'),
					checked: missingDimensions.includes('false'),
				},
			],
		);
		return controls;
	}, [missingAlt, missingDimensions, params, t, updateMany]);

	return (
		<div className="view">
			<ViewHeader
				titleKey="views.images.title"
				descriptionKey="views.images.description"
			/>
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
