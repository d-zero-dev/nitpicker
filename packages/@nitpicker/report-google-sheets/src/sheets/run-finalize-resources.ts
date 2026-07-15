import type { CreateSheetSetting } from './types.js';
import type { Lanes } from '@d-zero/dealer';
import type { Sheet } from '@d-zero/google-sheets';

import { sheetLog } from '../debug.js';

/**
 * Parameters for {@link runFinalizeResources}.
 */
export interface RunFinalizeResourcesParams {
	/** Sheet setting that may declare a `finalizeResources` hook. */
	readonly setting: CreateSheetSetting;
	/** Google Sheets wrapper that buffers and sends rows. */
	readonly sheet: Sheet;
	/** Optional Lanes instance for terminal progress display. */
	readonly lanes?: Lanes;
	/** Lane ID assigned to this sheet. */
	readonly laneId: number;
	/** Display name of the sheet (used in progress messages). */
	readonly sheetName: string;
}

/**
 * Calls the `finalizeResources` hook (Phase 3 terminator) and streams the
 * aggregated rows through `sheet.appendRow(...rows)`, subscribing to
 * `sheet.onProgress` so chunk-flush progress is mirrored to Lanes.
 *
 * - No-op when the setting has no `finalizeResources` hook.
 * - No-op when the hook returns `null` / empty array.
 * - Always resets `sheet.onProgress` in a `finally` block, even when
 *   `appendRow` throws — preventing a stale handler from leaking into
 *   a different sheet's lane.
 *
 * Known limitation (V8 argument cap): the aggregated rows are spread into
 * `sheet.appendRow(...finalRows)`, so an array longer than V8's practical
 * argument limit (~65k) throws `RangeError: Maximum call stack size
 * exceeded`. Verified working at 1.6M raw resources → 63k aggregated rows.
 * If aggregates ever exceed ~60k, switch to chunked calls (e.g. 10k per
 * `appendRow`) — the Sheet's internal 2500-row buffer is call-count
 * agnostic, so outer chunking preserves ordering and total send count.
 * The spec pins behaviour at 100 rows to stay clear of the V8 limit.
 * @param params - Hook invocation context (see {@link RunFinalizeResourcesParams}).
 */
export async function runFinalizeResources(params: RunFinalizeResourcesParams) {
	const { setting, sheet, lanes, laneId, sheetName } = params;

	if (!setting.finalizeResources) return;

	lanes?.update(laneId, `${sheetName}: Finalizing aggregated rows%dots%`);
	sheetLog('[%s] finalizeResources start', sheetName);
	const finalRows = await setting.finalizeResources();
	if (!finalRows || finalRows.length === 0) return;

	const total = finalRows.length;
	lanes?.update(laneId, `${sheetName}: Sending 0/${total} aggregated rows%dots%`);
	sheet.onProgress = (sent) => {
		lanes?.update(laneId, `${sheetName}: Sending ${sent}/${total} aggregated rows%dots%`);
	};
	try {
		await sheet.appendRow(...finalRows);
	} finally {
		sheet.onProgress = undefined;
	}
	sheetLog('[%s] finalizeResources emitted %d rows', sheetName, total);
}
