import type { ImageEntry } from '@nitpicker/query';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { useImagesInfinite } from '../api/use-images-infinite.js';
import { usePagedQuery } from '../api/use-paged-query.js';
import { DataTable } from '../components/data-table.js';
import { FilterBar } from '../components/filter-bar.js';
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
	const { params, update } = useUrlFilter();
	const { t } = useI18n();
	const { mode, pageSize, currentPage, setPage, setPageSize } = useListPagination();
	const filter = {
		missingAlt: params.get('missingAlt') === 'true' ? true : undefined,
		missingDimensions: params.get('missingDimensions') === 'true' ? true : undefined,
		urlPattern: params.get('urlPattern') ?? undefined,
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

	return (
		<div className="view">
			<ViewHeader
				titleKey="views.images.title"
				descriptionKey="views.images.description"
			/>
			<FilterBar>
				<label>
					<input
						type="checkbox"
						checked={filter.missingAlt ?? false}
						onChange={(e) => {
							update('missingAlt', e.target.checked ? 'true' : '');
						}}
					/>
					{t('views.images.filterMissingAlt')}
				</label>
				<label>
					<input
						type="checkbox"
						checked={filter.missingDimensions ?? false}
						onChange={(e) => {
							update('missingDimensions', e.target.checked ? 'true' : '');
						}}
					/>
					{t('views.images.filterMissingDimensions')}
				</label>
				<input
					aria-label={t('views.images.filterUrlPattern')}
					placeholder={t('views.images.filterUrlPattern')}
					defaultValue={filter.urlPattern ?? ''}
					onBlur={(e) => {
						update('urlPattern', e.target.value);
					}}
				/>
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
