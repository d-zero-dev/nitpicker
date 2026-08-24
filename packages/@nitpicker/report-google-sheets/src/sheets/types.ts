import type { Sheet } from '@d-zero/google-sheets';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Report } from '@nitpicker/types';
import type { sheets_v4 } from 'googleapis';

/** A value that may be synchronous or wrapped in a Promise. */
export type Promiseable<T> = Promise<T> | T;

/** A single header cell value (plain string). */
export type HeaderCell = string;

/** Google Sheets text format options (font, color, link, etc.). */
export type createCellTextFormat = sheets_v4.Schema$TextFormat;

/**
 * Per-sheet context passed to {@link CreateSheetSetting.run}.
 */
export interface RunSheetContext {
	/** The Google Sheets API wrapper for this tab. `appendRow`/`flush` drive the streaming send. */
	readonly sheet: Sheet;
	/**
	 * The maximum number of data rows this sheet may send, decided by the
	 * shared cell-budget allocation (`estimate-cell-budget.ts`) — see
	 * `create-sheets.ts`'s Phase 2 docs. `run()` must stop generating rows
	 * once it has sent this many (a `break` out of its own loop), not rely
	 * on the caller to truncate for it — the row source is a streaming
	 * generator the caller cannot safely interrupt mid-row.
	 */
	readonly maxRows: number;
	/**
	 * Reports rows sent so far, out of the sheet's own estimated total
	 * (from `estimateRowCount()`), for the Lanes progress line. Call this
	 * periodically while iterating, not just once at the end.
	 * @param sent - Rows sent so far.
	 * @param total - This sheet's own estimated total row count.
	 */
	readonly onProgress: (sent: number, total: number) => void;
}

/**
 * Configuration for a single Google Sheet tab within the report.
 *
 * The `createSheets` pipeline calls these in order:
 *
 * 1. `createHeaders()` - Called once to set the header row (Phase 1).
 * 2. `estimateRowCount()` - Called once, before generation, for the
 *    cell-budget warning and the `run()` progress denominator.
 * 3. `run()` - Called once to generate and send every row (Phase 2, run in
 *    priority order — see `report.ts`'s `SHEET_PRIORITY_ORDER`).
 * 4. `updateSheet()` - Called once after every sheet's `run()` has
 *    completed, for formatting (frozen rows, conditional formatting, etc.).
 *
 * `run()` is expected to stream: generate a row, `sheet.appendRow(...)` it,
 * repeat. It must never accumulate the full row set in memory before
 * sending — that reintroduces the OOM class this contract exists to close.
 * Lazy (`createCellData(() => ...)`) cells are forbidden for the same
 * reason (see `create-cell-data.ts`'s docs): a single lazy cell disables
 * `@d-zero/google-sheets`' automatic 2500-row flush for the rest of the
 * sheet's rows.
 */
export interface CreateSheetSetting {
	/** Display name of the sheet tab in Google Sheets. */
	name: string;
	/**
	 * `true` iff `run()` reads from the viewer read model (`viewer_pages`,
	 * `viewer_anchor_facts`, `viewer_images`, etc.) — `report.ts` only calls
	 * `requireViewerReadModel` once, up front, when at least one selected
	 * sheet sets this. Sheets that read only write-model tables (Links,
	 * Resources, Violations) must leave this `false`/omitted so a report
	 * limited to those sheets never requires a `viewer-build` run. Defaults
	 * to `false`.
	 */
	requiresReadModel?: boolean;
	/** Returns the header row cell values. */
	createHeaders: () => Promiseable<HeaderCell[]>;
	/**
	 * Estimates this sheet's total data row count, for the cell-budget
	 * warning (`estimate-cell-budget.ts`) and the `run()` progress
	 * denominator. An approximation is fine (a `COUNT(*)`-style query) —
	 * `run()` is the source of truth for what actually gets sent.
	 */
	estimateRowCount: () => Promiseable<number>;
	/**
	 * Generates and sends every row for this sheet, via `ctx.sheet.appendRow(...)`.
	 * Must stream (never build a full in-memory row array) and must stop
	 * once it has sent `ctx.maxRows` rows.
	 * @param ctx - See {@link RunSheetContext}.
	 */
	run: (ctx: RunSheetContext) => Promise<void>;
	/**
	 * Post-data formatting hook. Called after every sheet's `run()` has
	 * completed. Typically used for freezing rows/columns, conditional
	 * formatting, and hiding unused columns.
	 * @param sheet - The Google Sheets API wrapper for this tab.
	 */
	updateSheet?: (sheet: Sheet) => Promiseable<void>;
}

/**
 * Factory function that produces a {@link CreateSheetSetting} for one sheet.
 *
 * Receives the analyze plugin reports (for sheets like "Violations" or
 * "Discrepancies" that incorporate plugin data) and the archive accessor
 * (for `run()`/`estimateRowCount()` to query against).
 * @example
 * ```ts
 * const createMySheet: CreateSheet = (reports, accessor) => ({
 *   name: 'My Sheet',
 *   createHeaders: () => ['URL', 'Title'],
 *   estimateRowCount: async () => (await listViewerPages(accessor, { limit: 1 })).total,
 *   async run({ sheet, maxRows, onProgress }) {
 *     let sent = 0;
 *     let cursor: string | undefined;
 *     for (;;) {
 *       const page = await listViewerPages(accessor, { limit: 500, cursor });
 *       for (const item of page.items) {
 *         if (sent >= maxRows) return;
 *         await sheet.appendRow([
 *           createCellData({ value: item.url }, defaultCellFormat),
 *           createCellData({ value: item.title }, defaultCellFormat),
 *         ]);
 *         sent++;
 *         onProgress(sent, page.total);
 *       }
 *       if (!page.nextCursor) break;
 *       cursor = page.nextCursor;
 *     }
 *     await sheet.flush();
 *   },
 * });
 * ```
 */
export type CreateSheet = (
	reports: Report[],
	accessor: ArchiveAccessor,
) => Promiseable<CreateSheetSetting>;
