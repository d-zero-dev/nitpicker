import type { StatusCount } from '@nitpicker/query';

/**
 * Derives the React `key` and display label for one status-distribution row
 * on the Summary view. Kept out of the component so the two derivations are
 * unit-testable and cannot drift: the same `inventorySeed` check drives
 * both, because the seed row shares `status: 404` with the fix-target row —
 * keying on `status` alone would collide in React's reconciliation, and
 * labelling on `status` alone would render two indistinguishable "404"
 * rows.
 * @param entry - The status-distribution entry to present.
 * @returns The unique `key` and human-readable `label` for the row.
 * @example
 * buildStatusRowDescriptor({ status: 404, count: 2 });
 * // => { key: '404', label: '404' }
 * buildStatusRowDescriptor({ status: 404, count: 1200, inventorySeed: true });
 * // => { key: '404-inventory-seed', label: '404 (inventory-seed)' }
 * buildStatusRowDescriptor({ status: null, count: 1 });
 * // => { key: 'none', label: '—' }
 */
export function buildStatusRowDescriptor(entry: StatusCount): {
	key: string;
	label: string;
} {
	const base = entry.status === null ? null : String(entry.status);
	if (entry.inventorySeed) {
		return { key: `${base}-inventory-seed`, label: `${base} (inventory-seed)` };
	}
	return { key: base ?? 'none', label: base ?? '—' };
}
