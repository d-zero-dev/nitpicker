import type { ColumnDef } from '@tanstack/react-table';

import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useRef } from 'react';

import { useI18n } from '../i18n/use-i18n.js';

import { toAccessibleHeaderLabel } from './to-accessible-header-label.js';

/** Props for {@link VirtualTable}. */
export interface VirtualTableProps<T> {
	/** The currently loaded rows (a flat slice of the full result set). */
	data: T[];
	/** Column definitions. */
	columns: ColumnDef<T>[];
	/** Total number of matching rows on the server (for the row count display). */
	total: number;
	/** Whether more rows can be fetched. */
	hasNextPage: boolean;
	/** Whether a fetch is currently in flight. */
	isFetching: boolean;
	/** Whether the initial load is pending (shows skeleton rows). */
	isLoading?: boolean;
	/** Loads the next page; called as the user scrolls near the bottom. */
	onLoadMore: () => void;
	/** Fixed row height in pixels. Defaults to 36. */
	rowHeight?: number;
}

/** Distance (px) from the bottom at which the next page is prefetched. */
const LOAD_THRESHOLD = 400;

/** Number of placeholder rows shown while the initial load is pending. */
const SKELETON_ROWS = 12;

/** Upper bound (px) a column may be resized to; also the resizer's `aria-valuemax`. */
const MAX_COLUMN_WIDTH = 1000;

/**
 * A windowed (virtualized) table for very large datasets.
 *
 * Renders only the rows in the visible range (plus overscan) via
 * TanStack Virtual, and triggers `onLoadMore` as the user nears the bottom —
 * so 100k+ rows stay performant with a near-constant DOM and memory footprint.
 * The full set is never held client-side; pages stream in from the server.
 *
 * Columns are user-resizable: drag the right edge of a header, or focus the
 * resize separator and use the arrow keys (Shift for a larger step). While the
 * initial load is pending, skeleton rows are shown and the body is `aria-busy`.
 *
 * Because the CSS lays the table out with flexbox (which removes the native
 * table semantics), explicit ARIA roles and `aria-row/colcount`/`index`
 * attributes are applied so assistive technology still sees a navigable grid.
 * @param props - The table data, columns, and pagination callbacks.
 * @returns The virtualized table element.
 */
export function VirtualTable<T>(props: VirtualTableProps<T>) {
	const {
		data,
		columns,
		total,
		hasNextPage,
		isFetching,
		isLoading = false,
		onLoadMore,
		rowHeight = 36,
	} = props;
	const { t } = useI18n();
	const parentRef = useRef<HTMLDivElement>(null);

	const table = useReactTable({
		data,
		columns,
		getCoreRowModel: getCoreRowModel(),
		columnResizeMode: 'onChange',
		enableColumnResizing: true,
		defaultColumn: { minSize: 60 },
	});
	const { rows } = table.getRowModel();

	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => rowHeight,
		overscan: 20,
	});

	const maybeLoadMore = useCallback(() => {
		const element = parentRef.current;
		if (!element || isFetching || !hasNextPage) {
			return;
		}
		if (
			element.scrollHeight - element.scrollTop - element.clientHeight <
			LOAD_THRESHOLD
		) {
			onLoadMore();
		}
	}, [isFetching, hasNextPage, onLoadMore]);

	// Reset the scroll position whenever the dataset shrinks (filter/sort change).
	useEffect(() => {
		if (parentRef.current && data.length <= 0) {
			parentRef.current.scrollTop = 0;
		}
	}, [data.length]);

	const virtualRows = virtualizer.getVirtualItems();
	const showSkeleton = isLoading && rows.length === 0;
	const leafColumns = table.getAllLeafColumns();

	return (
		<div className="vt">
			<div className="vt-meta" role="status" aria-live="polite">
				{t('common.rowsOf', {
					loaded: data.length.toLocaleString(),
					total: total.toLocaleString(),
				})}
			</div>
			<div
				ref={parentRef}
				className="vt-scroll"
				onScroll={maybeLoadMore}
				aria-busy={isFetching || isLoading}>
				{/*
				 * The CSS lays the table out with flexbox (`display: flex/block`),
				 * which strips the native table semantics from the accessibility
				 * tree. Explicit ARIA roles (`table`/`rowgroup`/`row`/`columnheader`/
				 * `cell`) plus `aria-rowcount`/`aria-colcount`/`aria-rowindex`/
				 * `aria-colindex` restore them, so screen readers can navigate the
				 * windowed data by row and column even though only a slice is in the
				 * DOM (header row counts as row index 1; data rows start at 2).
				 */}
				<table
					className="vt-table"
					role="table"
					aria-rowcount={total + 1}
					aria-colcount={leafColumns.length}>
					<thead role="rowgroup">
						{table.getHeaderGroups().map((headerGroup) => (
							<tr key={headerGroup.id} role="row" aria-rowindex={1}>
								{headerGroup.headers.map((header, columnIndex) => {
									// Pin a plain-string header as the cell's accessible name so
									// the focusable resize separator's label (a descendant) does
									// not leak into it — otherwise the header reads as
									// "Title, Resize column…". See toAccessibleHeaderLabel.
									const headerLabel = toAccessibleHeaderLabel(
										header.column.columnDef.header,
									);
									return (
										<th
											key={header.id}
											role="columnheader"
											aria-colindex={columnIndex + 1}
											aria-label={headerLabel}
											style={{ width: header.getSize() }}>
											{flexRender(header.column.columnDef.header, header.getContext())}
											{header.column.getCanResize() && (
												<div
													className={`vt-resizer${
														header.column.getIsResizing() ? ' is-resizing' : ''
													}`}
													role="separator"
													aria-orientation="vertical"
													aria-label={t('common.resizeColumn')}
													aria-valuemin={header.column.columnDef.minSize ?? 60}
													aria-valuemax={MAX_COLUMN_WIDTH}
													aria-valuenow={Math.round(header.getSize())}
													tabIndex={0}
													onMouseDown={header.getResizeHandler()}
													onTouchStart={header.getResizeHandler()}
													onKeyDown={(event) => {
														if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
															return;
														}
														event.preventDefault();
														const step =
															(event.shiftKey ? 30 : 10) *
															(event.key === 'ArrowLeft' ? -1 : 1);
														const columnId = header.column.id;
														const minSize = header.column.columnDef.minSize ?? 60;
														const nextSize = Math.min(
															MAX_COLUMN_WIDTH,
															Math.max(minSize, header.getSize() + step),
														);
														table.setColumnSizing((old) => ({
															...old,
															[columnId]: nextSize,
														}));
													}}
												/>
											)}
										</th>
									);
								})}
							</tr>
						))}
					</thead>
					<tbody
						role="rowgroup"
						style={{
							height: showSkeleton ? undefined : `${virtualizer.getTotalSize()}px`,
						}}>
						{showSkeleton
							? Array.from({ length: SKELETON_ROWS }, (_, index) => (
									<tr
										key={`skeleton-${index}`}
										className="vt-row vt-skeleton-row"
										role="row"
										aria-hidden={true}>
										{leafColumns.map((column) => (
											<td key={column.id} role="cell" style={{ width: column.getSize() }}>
												<span className="vt-skeleton" />
											</td>
										))}
									</tr>
								))
							: virtualRows.map((virtualRow) => {
									const row = rows[virtualRow.index];
									if (!row) {
										return null;
									}
									return (
										<tr
											key={row.id}
											className="vt-row"
											role="row"
											aria-rowindex={virtualRow.index + 2}
											style={{ transform: `translateY(${virtualRow.start}px)` }}>
											{row.getVisibleCells().map((cell, columnIndex) => (
												<td
													key={cell.id}
													role="cell"
													aria-colindex={columnIndex + 1}
													style={{ width: cell.column.getSize() }}>
													{flexRender(cell.column.columnDef.cell, cell.getContext())}
												</td>
											))}
										</tr>
									);
								})}
					</tbody>
				</table>
			</div>
		</div>
	);
}
