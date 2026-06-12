import type { ImageEntry } from '@nitpicker/query';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { useImagesInfinite } from '../api/use-images-infinite.js';
import { FilterBar } from '../components/filter-bar.js';
import { ViewHeader } from '../components/view-header.js';
import { VirtualTable } from '../components/virtual-table.js';
import { useUrlFilter } from '../hooks/use-url-filter.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * The image list: a virtualized table for spotting missing alt text, missing
 * dimensions, and oversized images. Includes a thumbnail preview column.
 * @returns The images view element.
 */
export function ImagesView() {
	const { params, update } = useUrlFilter();
	const { t } = useI18n();
	const filter = {
		missingAlt: params.get('missingAlt') === 'true' ? true : undefined,
		missingDimensions: params.get('missingDimensions') === 'true' ? true : undefined,
		urlPattern: params.get('urlPattern') ?? undefined,
	};

	const { data, fetchNextPage, hasNextPage, isFetching, isLoading } =
		useImagesInfinite(filter);
	const rows = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
	const total = data?.pages[0]?.total ?? 0;

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
