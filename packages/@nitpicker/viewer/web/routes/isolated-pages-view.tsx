import type { IsolatedPageEntry } from '@nitpicker/query';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { useIsolatedPagesInfinite } from '../api/use-isolated-pages-infinite.js';
import { SourceBadge } from '../components/source-badge.js';
import { ViewHeader } from '../components/view-header.js';
import { VirtualTable } from '../components/virtual-table.js';
import { useI18n } from '../i18n/use-i18n.js';

/**
 * **完全孤立** page list: inventory-* HTML pages that form singleton
 * components in the inventory subgraph (no resolved-anchor inbound from any
 * other inventory-* node). Backed by `useIsolatedPagesInfinite` so the
 * rendered list grows to match the displayed `total` as the user scrolls —
 * unlike the previous fixed-100-row hook which left "{total} 件" lying
 * about the visible rows.
 * @returns The isolated pages view element.
 */
export function IsolatedPagesView() {
	const { t } = useI18n();
	const { data, fetchNextPage, hasNextPage, isFetching, isLoading } =
		useIsolatedPagesInfinite();
	const rows = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
	const total = data?.pages[0]?.total ?? 0;

	const columns = useMemo<ColumnDef<IsolatedPageEntry>[]>(
		() => [
			{
				id: 'url',
				header: t('views.isolatedPages.url'),
				size: 440,
				accessorFn: (r) => r.url,
				cell: (info) => <code>{info.getValue<string>()}</code>,
			},
			{
				id: 'title',
				header: t('views.isolatedPages.pageTitle'),
				size: 280,
				accessorFn: (r) => r.title ?? '—',
			},
			{
				id: 'status',
				header: t('views.isolatedPages.status'),
				size: 90,
				accessorFn: (r) => r.status ?? '—',
			},
			{
				id: 'source',
				header: t('views.isolatedPages.source'),
				size: 110,
				accessorFn: (r) => r.source,
				cell: (info) => (
					<SourceBadge source={info.getValue<IsolatedPageEntry['source']>()} />
				),
			},
		],
		[t],
	);

	return (
		<div className="view">
			<ViewHeader
				titleKey="views.isolatedPages.title"
				descriptionKey="views.isolatedPages.description"
			/>
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
