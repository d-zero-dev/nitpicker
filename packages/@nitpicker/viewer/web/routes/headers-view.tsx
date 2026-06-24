import type { HeaderCheckEntry } from '@nitpicker/query';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { useHeadersInfinite } from '../api/use-headers-infinite.js';
import { usePagedQuery } from '../api/use-paged-query.js';
import { DataTable } from '../components/data-table.js';
import { FilterBar } from '../components/filter-bar.js';
import { ViewHeader } from '../components/view-header.js';
import { useListPagination } from '../hooks/use-list-pagination.js';
import { useUrlFilter } from '../hooks/use-url-filter.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * Renders a boolean header-presence cell as a check or cross.
 * @param present - Whether the header is present.
 * @returns The cell content.
 */
function presence(present: boolean): string {
	return present ? '✓' : '✗';
}

/**
 * The security headers view: a table showing CSP / X-Frame-Options /
 * X-Content-Type-Options / HSTS presence per page, rendered via the user's
 * chosen pagination mode.
 * @returns The headers view element.
 */
export function HeadersView() {
	const { params, update } = useUrlFilter();
	const { t } = useI18n();
	const { mode, pageSize, currentPage, setPage, setPageSize } = useListPagination();
	const missingOnly = params.get('missingOnly') === 'true';

	const offset = (currentPage - 1) * pageSize;
	const paged = usePagedQuery<HeaderCheckEntry>(
		'/api/headers',
		{ missingOnly, limit: pageSize, offset },
		['headers-paged', missingOnly, pageSize, currentPage],
		{ enabled: mode === 'mpa' },
	);
	const infinite = useHeadersInfinite(missingOnly, { enabled: mode === 'virtual' });
	const infiniteRows = useMemo(
		() => infinite.data?.pages.flatMap((page) => page.items) ?? [],
		[infinite.data],
	);
	const infiniteTotal = infinite.data?.pages[0]?.total ?? 0;

	const columns = useMemo<ColumnDef<HeaderCheckEntry>[]>(
		() => [
			{
				accessorKey: 'url',
				header: t('views.headers.colUrl'),
				size: 400,
				cell: (i) => i.getValue<string>(),
			},
			{
				accessorKey: 'hasCSP',
				header: 'CSP',
				size: 90,
				cell: (i) => presence(i.getValue<boolean>()),
			},
			{
				accessorKey: 'hasXFrameOptions',
				header: 'X-Frame',
				size: 100,
				cell: (i) => presence(i.getValue<boolean>()),
			},
			{
				accessorKey: 'hasXContentTypeOptions',
				header: 'X-CTO',
				size: 90,
				cell: (i) => presence(i.getValue<boolean>()),
			},
			{
				accessorKey: 'hasHSTS',
				header: 'HSTS',
				size: 90,
				cell: (i) => presence(i.getValue<boolean>()),
			},
		],
		[t],
	);

	return (
		<div className="view">
			<ViewHeader
				titleKey="views.headers.title"
				descriptionKey="views.headers.description"
			/>
			<FilterBar>
				<label>
					<input
						type="checkbox"
						checked={missingOnly}
						onChange={(e) => {
							update('missingOnly', e.target.checked ? 'true' : '');
						}}
					/>
					{t('views.headers.filterMissingOnly')}
				</label>
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
