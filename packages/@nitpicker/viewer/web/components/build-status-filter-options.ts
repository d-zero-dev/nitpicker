import type { TableFilterOption } from './paged-table.js';

/**
 * Builds radio options for a numeric status filter from the visible dataset,
 * preserving the currently selected value even when it is absent from the
 * current page.
 * @param items - Rows from which to collect status values.
 * @param getStatus - Extracts the numeric status from a row.
 * @param currentStatus - Raw `?status=` query value.
 * @param allLabel - Label for the "all statuses" option.
 * @returns Radio options sorted numerically ascending.
 */
export function buildStatusFilterOptions<T>(
	items: readonly T[] | undefined,
	getStatus: (item: T) => number | null | undefined,
	currentStatus: string | null,
	allLabel: string,
): TableFilterOption[] {
	const selectedStatus =
		currentStatus != null && currentStatus.length > 0 ? Number(currentStatus) : undefined;
	const statuses = new Set<number>();
	for (const item of items ?? []) {
		const status = getStatus(item);
		if (typeof status === 'number' && Number.isFinite(status)) {
			statuses.add(status);
		}
	}
	if (selectedStatus != null && Number.isFinite(selectedStatus)) {
		statuses.add(selectedStatus);
	}
	return [
		{
			value: '',
			label: allLabel,
			checked: currentStatus == null || currentStatus === '',
		},
		...[...statuses]
			.toSorted((a, b) => a - b)
			.map((status) => ({
				value: String(status),
				label: String(status),
				checked: currentStatus === String(status),
			})),
	];
}
