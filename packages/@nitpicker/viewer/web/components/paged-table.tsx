import type { ColumnDef, PageSize } from '../types.js';
import type { RowData } from '@tanstack/react-table';

import { flexRender, useTable } from '@tanstack/react-table';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useCommandTarget } from '../hooks/use-command-target.js';
import { useI18n } from '../i18n/use-i18n.js';
import { viewerTableFeatures } from '../table-features.js';

import { Pager } from './pager.js';
import { toAccessibleHeaderLabel } from './to-accessible-header-label.js';

export type TableSortOrder = 'asc' | 'desc';

export interface TableSortControl {
	active: boolean;
	order?: TableSortOrder;
	onChange: (next: TableSortOrder | undefined) => void;
}

export interface TableFilterOption {
	value: string;
	label: string;
	checked: boolean;
}

export interface TableFilterControl {
	label: string;
	kind: 'checklist' | 'text';
	value?: string;
	options?: TableFilterOption[];
	onApply: (next?: string | string[]) => void;
}

export interface TableColumnControls {
	sort?: Record<string, TableSortControl | undefined>;
	filter?: Record<string, TableFilterControl | undefined>;
}

/** Props for {@link PagedTable}. */
export interface PagedTableProps<T extends RowData> {
	/** The rows on the currently selected page (already sliced server-side). */
	data: T[];
	/** Column definitions (shared with the virtual variant). */
	columns: ColumnDef<T>[];
	/** Total matching rows on the server. */
	total: number;
	/** Current 1-indexed page. */
	currentPage: number;
	/** Rows per page. */
	pageSize: PageSize;
	/** Called when the user requests a different page. */
	onPageChange: (next: number) => void;
	/** Called when the user picks a new page size. */
	onPageSizeChange: (next: PageSize) => void;
	/** Whether a fetch is currently in flight (for `aria-busy`). */
	isFetching: boolean;
	/** Whether the initial load is pending (shows skeleton rows). */
	isLoading?: boolean;
	/** Fixed row height in pixels. Defaults to 36. */
	rowHeight?: number;
	/** Optional sort/filter header controls keyed by column id. */
	columnControls?: TableColumnControls;
}

/** Number of placeholder rows shown while the initial load is pending. */
const SKELETON_ROWS = 12;

/** Upper bound (px) a column may be resized to; also the resizer's `aria-valuemax`. */
const MAX_COLUMN_WIDTH = 1000;

/**
 * Renders column-local controls without changing the resize affordance.
 * @param props - Header control lookup props.
 * @param props.columnId
 * @param props.controls
 */
function HeaderControls(props: { columnId: string; controls?: TableColumnControls }) {
	const sort = props.controls?.sort?.[props.columnId];
	const filter = props.controls?.filter?.[props.columnId];
	const filterKey = useMemo(
		() =>
			filter
				? [
						filter.kind,
						filter.value ?? '',
						...(filter.options?.map((option) => `${option.value}:${option.checked}`) ??
							[]),
					].join('|')
				: '',
		[filter],
	);
	if (!sort && !filter) return null;
	return (
		<span className="pt-header-controls">
			{sort && <SortButton control={sort} />}
			{filter && <FilterButton key={filterKey} control={filter} />}
		</span>
	);
}

/**
 * Advances the column sort cycle: ascending, descending, off. The button is
 * its own `commandfor` target: it receives the `--sort` command it sends.
 * @param props - Sort control props.
 * @param props.control
 */
function SortButton({ control }: { control: TableSortControl }) {
	const { t } = useI18n();
	const order = control.order ?? 'asc';
	const next: TableSortOrder | undefined = control.active
		? order === 'asc'
			? 'desc'
			: undefined
		: 'asc';
	const { id, ref } = useCommandTarget<HTMLButtonElement>({
		'--sort': () => {
			control.onChange(next);
		},
	});
	return (
		<button
			ref={ref}
			id={id}
			type="button"
			command="--sort"
			commandfor={id}
			className={`pt-header-button${control.active ? ' is-active' : ''}`}
			aria-label={t('tableControls.sort')}>
			{control.active ? (order === 'asc' ? '^' : 'v') : 'S'}
		</button>
	);
}

/**
 * Extracts selected filter option values from the current URL-backed control.
 * @param control - Filter control definition.
 * @returns Selected option values.
 */
function selectedValues(control: TableFilterControl) {
	return new Set(
		control.options?.filter((option) => option.checked).map((option) => option.value),
	);
}

/**
 * Popover editor for a column filter; changes are committed only on Apply.
 *
 * The editor is a `popover="auto"` element opened by the F button's built-in
 * `toggle-popover` command, so the browser closes it on an outside click or
 * Escape. Closing that way discards the draft: every open re-reads the
 * URL-backed `control` (`beforetoggle`). The element is rendered into
 * `document.body` so no ancestor's overflow or stacking context can clip it,
 * and anchored to the F button with CSS anchor positioning (below it, flipped
 * above when there is no room, clamped to the viewport, following the button
 * when the page scrolls or resizes). The popover is also the
 * `commandfor` target of its own Select all / None / Reset / Apply buttons.
 * @param props - Filter control props.
 * @param props.control
 */
function FilterButton({ control }: { control: TableFilterControl }) {
	const { t } = useI18n();
	const [hasOpened, setHasOpened] = useState(false);
	const [textValue, setTextValue] = useState(control.value ?? '');
	const [selected, setSelected] = useState(() => selectedValues(control));
	const active =
		control.kind === 'text'
			? (control.value?.length ?? 0) > 0
			: (control.options?.some((option) => option.checked) ?? false);

	const { id: popoverId, ref: popoverRef } = useCommandTarget<HTMLDivElement>({
		'--select-all': () => {
			setSelected(new Set(control.options?.map((option) => option.value)));
		},
		'--select-none': () => {
			setSelected(new Set());
		},
		// The command event is dispatched on the popover, so `currentTarget` is it.
		'--reset': (event) => {
			control.onApply();
			(event.currentTarget as HTMLElement).hidePopover();
		},
		'--apply': (event) => {
			if (control.kind === 'text') {
				control.onApply(textValue || undefined);
			} else {
				control.onApply([...selected]);
			}
			(event.currentTarget as HTMLElement).hidePopover();
		},
	});

	// The popover is positioned by CSS anchor positioning against the F button: a
	// per-instance anchor name ties the two (see `.pt-filter-popover` in styles.css).
	// `useId` output is only a valid dashed-ident in some React versions (`_r_0_`, not
	// `:r0:`), so keep just the characters a CSS identifier allows.
	const anchorName = `--pt-filter-${popoverId.replaceAll(/[^\w-]/g, '')}`;

	// `control` is rebuilt on every render of the table; the listeners below read the
	// latest one instead of being re-attached with it.
	const latestControl = useRef(control);
	latestControl.current = control;

	useEffect(() => {
		const popover = popoverRef.current;
		if (!popover) {
			return;
		}
		const onBeforeToggle = (event: Event) => {
			if ((event as ToggleEvent).newState !== 'open') {
				return;
			}
			const current = latestControl.current;
			setHasOpened(true);
			setTextValue(current.value ?? '');
			setSelected(selectedValues(current));
		};
		// Drop the body again once closed, so a closed filter holds no option list.
		const onToggle = (event: Event) => {
			if ((event as ToggleEvent).newState === 'closed') {
				setHasOpened(false);
			}
		};
		popover.addEventListener('beforetoggle', onBeforeToggle);
		popover.addEventListener('toggle', onToggle);
		return () => {
			popover.removeEventListener('beforetoggle', onBeforeToggle);
			popover.removeEventListener('toggle', onToggle);
		};
	}, [popoverRef]);

	// Rendered only while open: the popover shell must exist for the
	// F button's command to find (one empty `<div popover>` per filterable
	// column stays in `document.body`), but the inputs/options of a column's filter
	// need not be in the DOM until that filter is opened.
	const body = (
		<>
			{control.kind === 'text' ? (
				<input
					className="pt-filter-input"
					aria-label={control.label}
					value={textValue}
					onChange={(event) => {
						setTextValue(event.target.value);
					}}
					onKeyDown={(event) => {
						if (event.key === 'Enter') {
							control.onApply(textValue || undefined);
							popoverRef.current?.hidePopover();
						}
					}}
				/>
			) : (
				<>
					<div className="pt-filter-actions">
						<button type="button" command="--select-all" commandfor={popoverId}>
							{t('tableControls.selectAll')}
						</button>
						<button type="button" command="--select-none" commandfor={popoverId}>
							{t('tableControls.selectNone')}
						</button>
					</div>
					<div className="pt-filter-list">
						{control.options?.map((option) => (
							<label key={option.value} className="pt-filter-option">
								<input
									type="checkbox"
									checked={selected.has(option.value)}
									onChange={(event) => {
										const next = new Set(selected);
										if (event.target.checked) {
											next.add(option.value);
										} else {
											next.delete(option.value);
										}
										setSelected(next);
									}}
								/>
								<span>{option.label}</span>
							</label>
						))}
					</div>
				</>
			)}
			<div className="pt-filter-actions">
				<button type="button" command="--reset" commandfor={popoverId}>
					{t('tableControls.reset')}
				</button>
				<button type="button" command="--apply" commandfor={popoverId}>
					{t('tableControls.apply')}
				</button>
			</div>
		</>
	);
	const popover = (
		<div
			ref={popoverRef}
			id={popoverId}
			className="pt-filter-popover"
			popover="auto"
			role="dialog"
			style={{ positionAnchor: anchorName }}
			aria-label={control.label}>
			{hasOpened ? body : null}
		</div>
	);
	return (
		<span className="pt-filter">
			<button
				type="button"
				className={`pt-header-button${active ? ' is-active' : ''}`}
				command="toggle-popover"
				commandfor={popoverId}
				style={{ anchorName }}
				aria-label={control.label}>
				F
			</button>
			{typeof document === 'undefined' ? null : createPortal(popover, document.body)}
		</span>
	);
}

/**
 * A classic per-page table for MPA pagination — the same ARIA / column-
 * resize surface as {@link import('./virtual-table.js').VirtualTable}, but
 * without the virtualizer, plus a {@link Pager} footer.
 *
 * Renders every row of the current page (`data.length === pageSize` for full
 * pages) so the browser holds at most `pageSize` rows of DOM — sufficient
 * even at the upper bound ({@link import('../hooks/use-page-size.js').PAGE_SIZE_OPTIONS}'s
 * max) and far smaller than virtual mode's accumulated infinite scroll.
 * Pagination state lives in the URL (`?page=`) via
 * {@link import('../hooks/use-current-page.js').useCurrentPage}.
 *
 * The ARIA grid metadata (`aria-rowcount`, `aria-colcount`, `aria-rowindex`,
 * `aria-colindex`) is re-emitted here because the CSS flexbox layout strips
 * the native table semantics — same rationale as the virtualized variant.
 * @param props - Page rows, columns, and pagination handlers.
 * @returns The paged table element.
 */
export function PagedTable<T extends RowData>(props: PagedTableProps<T>) {
	const {
		data,
		columns,
		total,
		currentPage,
		pageSize,
		onPageChange,
		onPageSizeChange,
		isFetching,
		isLoading = false,
		rowHeight = 36,
		columnControls,
	} = props;
	const { t } = useI18n();

	const table = useTable({
		features: viewerTableFeatures,
		data,
		columns,
		columnResizeMode: 'onChange',
		enableColumnResizing: true,
		defaultColumn: { minSize: 60 },
	});
	const { rows } = table.getRowModel();
	const showSkeleton = isLoading && rows.length === 0;
	const leafColumns = table.getAllLeafColumns();
	const totalPages = Math.max(1, Math.ceil(total / pageSize));

	// Reconcile an out-of-range `?page=N` (deep-link / hand-edit / stale
	// bookmark from before the dataset shrunk / filter narrowed) by writing
	// the clamped value back to the URL. Without this the Pager visually
	// clamps but the URL keeps the bad value, every fetch wastes round-trips
	// on offset=N*pageSize that returns empty, and the user can only escape
	// by hand-editing.
	//
	// Skip while loading so the very first render does not race the in-flight
	// fetch (total is `0` until the response arrives) — that would clear the
	// user's `?page=` deep-link before the data has even shown up.
	useEffect(() => {
		if (isLoading) return;
		if (currentPage > totalPages) {
			onPageChange(totalPages);
		}
	}, [isLoading, currentPage, totalPages, onPageChange]);

	// Show the in-flight overlay whenever a refetch is happening on top of
	// already-rendered data (keepPreviousData kept the prior page visible).
	// The initial-load case is handled by `showSkeleton` below — distinct UX
	// so a fresh visit shows skeleton rows, a Next-click shows the overlay
	// over still-visible-prior-page data.
	const showRefetchOverlay = isFetching && !showSkeleton;

	return (
		<div className="pt">
			<div className="pt-meta" role="status" aria-live="polite">
				{t('pagination.totalRows', { total: total.toLocaleString() })}
				{showRefetchOverlay ? ` · ${t('pagination.refreshing')}` : ''}
			</div>
			<div
				className={`pt-scroll${showRefetchOverlay ? ' is-fetching' : ''}`}
				aria-busy={isFetching || isLoading}>
				{/*
				 * The CSS lays the table out with flexbox (`display: flex/block`),
				 * stripping native table semantics from the accessibility tree.
				 * Explicit ARIA roles (`table`/`rowgroup`/`row`/`columnheader`/
				 * `cell`) plus `aria-rowcount`/`aria-colcount`/`aria-rowindex`/
				 * `aria-colindex` restore them so screen readers can navigate the
				 * page by row and column (header row counts as row index 1; data
				 * rows start at 2). `.markuplintrc.json` exempts `table.pt-table`/`tr[role=row]`/
				 * `td[aria-colindex]` from the role and ARIA-prop rules for this reason, and
				 * this file from the table-model rules (`.map()` cells cannot be counted).
				 */}
				<table
					className="pt-table"
					role="table"
					aria-rowcount={total + 1}
					aria-colcount={leafColumns.length}>
					<thead>
						{table.getHeaderGroups().map((headerGroup) => (
							<tr key={headerGroup.id} role="row" aria-rowindex={1}>
								{headerGroup.headers.map((header, columnIndex) => {
									// Pin a plain-string header as the cell's accessible name so
									// the focusable resize separator's label (a descendant) does
									// not leak into it.
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
											<span className="pt-header-content">
												<span className="pt-header-label">
													{flexRender(
														header.column.columnDef.header,
														header.getContext(),
													)}
												</span>
												<HeaderControls
													columnId={header.column.id}
													controls={columnControls}
												/>
											</span>
											{header.column.getCanResize() && (
												// The resizer is intentionally a focusable, keyboard-operable
												// `<div role="separator">` — same trade-off as virtual-table.tsx.
												<div
													className={`pt-resizer${
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
					<tbody>
						{showSkeleton
							? Array.from({ length: SKELETON_ROWS }, (_, index) => (
									<tr
										key={`skeleton-${index}`}
										className="pt-row pt-skeleton-row"
										role="row"
										aria-hidden={true}
										style={{ height: rowHeight }}>
										{leafColumns.map((column) => (
											<td key={column.id} style={{ width: column.getSize() }}>
												<span className="pt-skeleton" />
											</td>
										))}
									</tr>
								))
							: rows.map((row, rowIndex) => (
									<tr
										key={row.id}
										className="pt-row"
										role="row"
										aria-rowindex={(currentPage - 1) * pageSize + rowIndex + 2}
										style={{ height: rowHeight }}>
										{row.getVisibleCells().map((cell, columnIndex) => (
											<td
												key={cell.id}
												aria-colindex={columnIndex + 1}
												style={{ width: cell.column.getSize() }}>
												{flexRender(cell.column.columnDef.cell, cell.getContext())}
											</td>
										))}
									</tr>
								))}
					</tbody>
				</table>
			</div>
			<Pager
				currentPage={currentPage}
				total={total}
				pageSize={pageSize}
				onPageChange={onPageChange}
				onPageSizeChange={onPageSizeChange}
			/>
		</div>
	);
}
