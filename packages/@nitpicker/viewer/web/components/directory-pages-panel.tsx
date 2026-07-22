import type { DirectoryPageListItem, DirectoryTreeNode } from '@nitpicker/query';
import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { useDirectoryTreePagesInfinite } from '../api/use-directory-tree-pages-infinite.js';
import { useI18n } from '../i18n/use-i18n.js';

import { DataTable } from './data-table.js';

/** Props for {@link DirectoryPagesPanel}. */
export interface DirectoryPagesPanelProps {
	/** The selected directory node whose direct pages to list. */
	node: DirectoryTreeNode;
}

/**
 * Lists a directory node's direct pages (never its descendants) via
 * `GET /api/directory-tree/pages`, reusing the shared {@link DataTable} in
 * virtual (infinite-scroll) mode.
 *
 * The endpoint has no `total` in its response (forward-only cursor
 * pagination only), so `node.directPageCount` — precomputed at viewer
 * read-model build time — doubles as the table's `total` without an extra
 * request. This is a snapshot, not a live count: if the read model is
 * rebuilt (`nitpicker viewer-build --force`) while this tab stays open and
 * the cached tree query hasn't refreshed, `directPageCount` can briefly
 * disagree with the live page rows. Not worth reconciling — it only affects
 * an operator who force-rebuilds mid-session, and the "X of Y rows" status
 * self-corrects on the next `/api/directory-tree` refetch.
 * @param props - The panel props.
 * @param props.node
 * @returns The pages panel element.
 */
export function DirectoryPagesPanel({ node }: DirectoryPagesPanelProps) {
	const { t } = useI18n();
	const infinite = useDirectoryTreePagesInfinite(node.nodeId, {
		enabled: node.directPageCount > 0,
	});
	const rows = useMemo(
		() => infinite.data?.pages.flatMap((page) => page.items) ?? [],
		[infinite.data],
	);

	const columns = useMemo<ColumnDef<DirectoryPageListItem>[]>(
		() => [
			{
				accessorKey: 'title',
				header: t('views.directoryTree.colTitle'),
				size: 240,
				cell: (info) => info.getValue<string | null>() ?? '—',
			},
			{ accessorKey: 'url', header: t('views.directoryTree.colUrl'), size: 340 },
			{
				accessorKey: 'status',
				header: t('views.directoryTree.colStatus'),
				size: 90,
				cell: (info) => info.getValue<number | null>() ?? '—',
			},
			{
				accessorKey: 'contentCategory',
				header: t('views.directoryTree.colContentType'),
				size: 160,
			},
		],
		[t],
	);

	if (node.directPageCount === 0) {
		return <p>{t('views.directoryTree.noPages')}</p>;
	}

	return (
		<div className="directory-pages-panel">
			<h2>{t('views.directoryTree.pagesPanelTitle', { path: node.path })}</h2>
			<DataTable
				mode="virtual"
				columns={columns}
				data={rows}
				total={node.directPageCount}
				hasNextPage={infinite.hasNextPage}
				isFetching={infinite.isFetching}
				isLoading={infinite.isLoading}
				isError={infinite.isError}
				error={infinite.error}
				onLoadMore={() => {
					void infinite.fetchNextPage();
				}}
			/>
		</div>
	);
}
