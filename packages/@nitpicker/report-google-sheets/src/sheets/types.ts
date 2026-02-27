import type { Cell, Sheet } from '@d-zero/google-sheets';
import type { Page, ArchiveResource as Resource } from '@nitpicker/crawler';
import type { Report } from '@nitpicker/types';
import type { sheets_v4 } from 'googleapis';

/** A value that may be synchronous or wrapped in a Promise. */
export type Promiseable<T> = Promise<T> | T;

/** A single header cell value (plain string). */
export type HeaderCell = string;

/** Google Sheets text format options (font, color, link, etc.). */
export type createCellTextFormat = sheets_v4.Schema$TextFormat;

/**
 * Factory function that produces a {@link CreateSheetSetting} for one sheet.
 *
 * Receives the analyze plugin reports so that sheets like "Violations" or
 * "Discrepancies" can incorporate plugin data alongside crawler data.
 * @example
 * ```ts
 * const createMySheet: CreateSheet = (reports) => ({
 *   name: 'My Sheet',
 *   createHeaders: () => ['URL', 'Title'],
 *   eachPage: (page) => [[
 *     createCellData({ value: page.url.href }, defaultCellFormat),
 *     createCellData({ value: page.title }, defaultCellFormat),
 *   ]],
 * });
 * ```
 */
export type CreateSheet = (reports: Report[]) => Promiseable<CreateSheetSetting>;

/**
 * Configuration for a single Google Sheet tab within the report.
 *
 * The `createSheets` pipeline calls these hooks in a defined order:
 *
 * 1. `createHeaders()` - Called once to set the header row.
 * 2. `preEachPage()` - (Phase 2) Called per page for pre-processing
 *    (e.g. accumulating state). No row data is returned.
 * 3. `eachPage()` - (Phase 2) Called per page to generate row data.
 *    Returns `Cell[][]` (one or more rows per page), `null` to skip,
 *    or `void` if this sheet does not use page data.
 * 4. `eachResource()` - (Phase 3) Called per network resource.
 *    Same return semantics as `eachPage`.
 * 5. `addRows()` - (Phase 4) Called once to add plugin-derived data
 *    that does not come from page/resource iteration (e.g. Violations).
 *    Runs in parallel with Phases 2-3.
 * 6. `updateSheet()` - (Phase 5) Called once after all data is written,
 *    for formatting (frozen rows, conditional formatting, etc.).
 */
export interface CreateSheetSetting {
	/** Display name of the sheet tab in Google Sheets. */
	name: string;
	/** Returns the header row cell values. */
	createHeaders: () => Promiseable<HeaderCell[]>;
	/**
	 * Pre-processing hook called for each page before `eachPage`.
	 * Useful for accumulating state (e.g. index titles, referrer maps)
	 * that subsequent `eachPage` calls depend on.
	 * @param page - The current page object.
	 * @param num - 1-based page number within the total.
	 * @param total - Total number of pages.
	 * @param prevPage - The previous page in iteration order, or `null` for the first.
	 */
	preEachPage?: (
		page: Page,
		num: number,
		total: number,
		prevPage: Page | null,
	) => Promiseable<void>;
	/**
	 * Generates row data for a single page.
	 * @param page - The current page object.
	 * @param num - 1-based page number within the total.
	 * @param total - Total number of pages.
	 * @param prevPage - The previous page, or `null` for the first.
	 * @returns Row data (one or more rows), `null`/`void` to skip.
	 */
	eachPage?: (
		page: Page,
		num: number,
		total: number,
		prevPage: Page | null,
	) => Promiseable<Cell[][] | null | void>;
	/**
	 * Generates row data for a single network resource.
	 * @param resource - The resource record from the archive.
	 * @returns Row data, `null`/`void` to skip.
	 */
	eachResource?: (resource: Resource) => Promiseable<Cell[][] | null | void>;
	/**
	 * Generates additional rows from plugin report data.
	 * Called once after the factory, not per-page. Runs in parallel
	 * with page/resource phases so it does not block them.
	 */
	addRows?: () => Promiseable<Cell[][] | null | void>;
	/**
	 * Post-data formatting hook. Called after all rows have been sent.
	 * Typically used for freezing rows/columns, conditional formatting,
	 * and hiding unused columns.
	 * @param sheet - The Google Sheets API wrapper for this tab.
	 */
	updateSheet?: (sheet: Sheet) => Promiseable<void>;
}
