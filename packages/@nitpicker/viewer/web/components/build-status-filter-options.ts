import type { TableFilterOption } from './paged-table.js';

/**
 * Builds checkbox options for a numeric status filter from the visible
 * dataset, preserving every currently selected value even when absent from
 * the current page (so switching pages never silently drops a selection from
 * the popover). There is no "all" option: an empty selection already means
 * "no filter, show everything" ({@link addChecklistFilter}'s OR semantics),
 * so a separate all-statuses checkbox would be redundant with clearing every
 * box.
 * @param options
 * @param options.items - Rows from which to collect status values.
 * @param options.getStatus - Extracts the numeric status from a row.
 * @param options.currentStatuses - Raw `?status=` query values (repeated param).
 * @returns Checkbox options sorted numerically ascending.
 * @example
 * buildStatusFilterOptions({
 *   items: paged.data?.items,
 *   getStatus: (item) => item.status,
 *   currentStatuses: params.getAll('status'),
 * });
 */
export function buildStatusFilterOptions<T>(options: {
	items: readonly T[] | undefined;
	getStatus: (item: T) => number | null | undefined;
	currentStatuses: readonly string[];
}): TableFilterOption[] {
	const selected = new Set(options.currentStatuses.filter((value) => value.length > 0));
	const statuses = new Set<number>();
	for (const item of options.items ?? []) {
		const status = options.getStatus(item);
		if (typeof status === 'number' && Number.isFinite(status)) {
			statuses.add(status);
		}
	}
	for (const value of selected) {
		const status = Number(value);
		if (Number.isFinite(status)) {
			statuses.add(status);
		}
	}
	return [...statuses]
		.toSorted((a, b) => a - b)
		.map((status) => ({
			value: String(status),
			label: String(status),
			checked: selected.has(String(status)),
		}));
}
