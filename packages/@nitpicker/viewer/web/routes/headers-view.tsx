import type { HeaderCheckEntry } from '@nitpicker/query';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';
import { useSearchParams } from 'react-router';

import { useHeadersInfinite } from '../api/use-headers-infinite.js';
import { FilterBar } from '../components/filter-bar.js';
import { ViewHeader } from '../components/view-header.js';
import { VirtualTable } from '../components/virtual-table.js';
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
 * The security headers view: a virtualized table showing CSP / X-Frame-Options
 * / X-Content-Type-Options / HSTS presence per page.
 * @returns The headers view element.
 */
export function HeadersView() {
	const [params, setParams] = useSearchParams();
	const { t } = useI18n();
	const missingOnly = params.get('missingOnly') === 'true';

	const { data, fetchNextPage, hasNextPage, isFetching, isLoading } =
		useHeadersInfinite(missingOnly);
	const rows = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
	const total = data?.pages[0]?.total ?? 0;

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
							const next = new URLSearchParams(params);
							if (e.target.checked) {
								next.set('missingOnly', 'true');
							} else {
								next.delete('missingOnly');
							}
							setParams(next);
						}}
					/>
					{t('views.headers.filterMissingOnly')}
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
