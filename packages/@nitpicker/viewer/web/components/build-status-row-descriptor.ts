import type { I18nValue } from '../types.js';
import type { StatusCount } from '@nitpicker/query';

import { getStatusLabel } from '../i18n/get-status-label.js';

/**
 * Derives the React `key` and display label for one status-distribution row
 * on the Summary view. Kept out of the component so the two derivations are
 * unit-testable and cannot drift: the same `inventorySeed` check drives
 * both, because the seed row shares `status: 404` with the fix-target row —
 * keying on `status` alone would collide in React's reconciliation, and
 * labelling on `status` alone would render two indistinguishable "404"
 * rows. The `key` stays numeric (`-1`) while the label goes through
 * {@link getStatusLabel}, so the internal fetch-failure sentinel reads as
 * "Fetch error" without disturbing row identity.
 * @param entry - The status-distribution entry to present.
 * @param t - The active translate function (from `useI18n()`).
 * @returns The unique `key` and human-readable `label` for the row.
 * @example
 * buildStatusRowDescriptor({ status: 404, count: 2 }, t);
 * // => { key: '404', label: '404' }
 * buildStatusRowDescriptor({ status: 404, count: 1200, inventorySeed: true }, t);
 * // => { key: '404-inventory-seed', label: '404 (inventory-seed)' }
 * buildStatusRowDescriptor({ status: -1, count: 3 }, t);
 * // => { key: '-1', label: 'Fetch error' }
 * buildStatusRowDescriptor({ status: null, count: 1 }, t);
 * // => { key: 'none', label: '—' }
 */
export function buildStatusRowDescriptor(
	entry: StatusCount,
	t: I18nValue['t'],
): {
	key: string;
	label: string;
} {
	const base = entry.status === null ? null : String(entry.status);
	const label = getStatusLabel(entry.status, t);
	if (entry.inventorySeed) {
		return { key: `${base}-inventory-seed`, label: `${label} (inventory-seed)` };
	}
	return { key: base ?? 'none', label: label ?? '—' };
}
