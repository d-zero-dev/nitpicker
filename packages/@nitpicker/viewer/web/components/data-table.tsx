import type { PageSize } from '../types.js';
import type { TableColumnControls } from './paged-table.js';
import type { ColumnDef } from '@tanstack/react-table';

import { PagedTable } from './paged-table.js';
import { VirtualTable } from './virtual-table.js';

/** Common props shared by both pagination modes. */
interface DataTableBaseProps<T> {
	/** Column definitions, shared verbatim between the two modes. */
	columns: ColumnDef<T>[];
	/** Total matching rows on the server. */
	total: number;
	/** Whether the initial load is pending (drives skeleton rows). */
	isLoading?: boolean;
	/** Whether a fetch is in flight (drives `aria-busy`). */
	isFetching: boolean;
	/**
	 * Whether the active query is in an error state. Surfaces an inline
	 * banner above the table so a failed `/api/*` call is visible rather
	 * than silently rendering an empty table. The view passes the active
	 * query's error (MPA → `usePagedQuery`, virtual → infinite hook).
	 */
	isError?: boolean;
	/** The error from the active query, when {@link DataTableBaseProps.isError} is true. */
	error?: Error | null;
}

/** MPA-mode props for {@link DataTable}. */
export interface DataTableMpaProps<T> extends DataTableBaseProps<T> {
	/** The discriminator value. */
	mode: 'mpa';
	/** The rows on the currently selected page. */
	data: T[];
	/** Optional sort/filter controls for paged table headers. */
	columnControls?: TableColumnControls;
	/** Current 1-indexed page (read from `?page=`). */
	currentPage: number;
	/** Rows per page (from the user's `usePageSize` preference). */
	pageSize: PageSize;
	/** Called when the user requests a different page. */
	onPageChange: (next: number) => void;
	/** Called when the user picks a new page size. */
	onPageSizeChange: (next: PageSize) => void;
}

/** Virtual-mode props for {@link DataTable}. */
export interface DataTableVirtualProps<T> extends DataTableBaseProps<T> {
	/** The discriminator value. */
	mode: 'virtual';
	/** The accumulated rows from every fetched infinite-query page. */
	data: T[];
	/** Whether more rows can be fetched. */
	hasNextPage: boolean;
	/** Loads the next page; called as the user scrolls near the bottom. */
	onLoadMore: () => void;
}

/** The union of MPA and virtual props for {@link DataTable}. */
export type DataTableProps<T> = DataTableMpaProps<T> | DataTableVirtualProps<T>;

/**
 * A thin dispatcher that picks the concrete table component based on the
 * user's pagination-mode preference.
 *
 * The discriminated `mode` field forces TypeScript to verify that the right
 * subset of props is passed for each branch — `currentPage` cannot leak into
 * virtual mode and `onLoadMore` cannot leak into MPA mode.
 *
 * Two components rather than one CSS-class-switching component because their
 * row-mounting strategies are fundamentally different — virtual mode uses
 * `transform`-positioned rows inside a sentinel-tall tbody, while MPA mode
 * renders ordinary in-flow rows. A single component would just be both
 * branches behind an `if`.
 * @param props - Mode-specific data and handlers.
 * @returns The chosen table element.
 */
export function DataTable<T>(props: DataTableProps<T>) {
	const errorBanner =
		props.isError === true ? (
			<p className="error" role="alert">
				{props.error?.message ?? 'Error'}
			</p>
		) : null;
	if (props.mode === 'mpa') {
		return (
			<>
				{errorBanner}
				<PagedTable
					data={props.data}
					columns={props.columns}
					columnControls={props.columnControls}
					total={props.total}
					currentPage={props.currentPage}
					pageSize={props.pageSize}
					onPageChange={props.onPageChange}
					onPageSizeChange={props.onPageSizeChange}
					isFetching={props.isFetching}
					isLoading={props.isLoading}
				/>
			</>
		);
	}
	return (
		<>
			{errorBanner}
			<VirtualTable
				data={props.data}
				columns={props.columns}
				total={props.total}
				hasNextPage={props.hasNextPage}
				isFetching={props.isFetching}
				isLoading={props.isLoading}
				onLoadMore={props.onLoadMore}
			/>
		</>
	);
}
