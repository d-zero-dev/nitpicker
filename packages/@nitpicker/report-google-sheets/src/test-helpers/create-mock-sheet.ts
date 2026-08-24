import type { Cell, Sheet } from '@d-zero/google-sheets';

/** A fake `Sheet` that records every `appendRow`/`flush`/formatting call instead of hitting the API. */
export interface MockSheet {
	/** The fake `Sheet`, cast to the real type for passing to `run()`/`updateSheet()`. */
	readonly sheet: Sheet;
	/** Every row appended so far, in call order. */
	readonly rows: Cell[][];
	/** Number of times `flush()` was called. */
	readonly flushCount: number;
	/** Headers set via `setHeaders()`, or `[]` if never called. */
	readonly headers: string[];
	/** Every `conditionalFormat()` call's arguments, in call order. */
	readonly conditionalFormatCalls: unknown[][];
}

/**
 * Creates a fake `Sheet` for testing `CreateSheetSetting.run()`/`updateSheet()`
 * without a real Google Sheets API connection.
 *
 * `appendRow` mirrors the real `@d-zero/google-sheets` `Sheet`'s rest-param
 * signature (`appendRow(...rows: Cell[][])`) — each call's arguments are
 * flattened into {@link MockSheet.rows} in order, so a test calling
 * `sheet.appendRow(row)` (one row per call, the new `run()` contract's
 * convention) sees `rows` grow by exactly one entry per call.
 * @returns A {@link MockSheet}.
 * @example
 * const mock = createMockSheet();
 * await setting.run({ sheet: mock.sheet, maxRows: 10, onProgress: () => {} });
 * expect(mock.rows).toHaveLength(3);
 */
export function createMockSheet(): MockSheet {
	const rows: Cell[][] = [];
	const conditionalFormatCalls: unknown[][] = [];
	let flushCount = 0;
	let headers: string[] = [];

	const sheet = {
		setHeaders(newHeaders: string[]) {
			headers = newHeaders;
			return Promise.resolve();
		},
		appendRow(...appendedRows: Cell[][]) {
			for (const row of appendedRows) {
				rows.push(row);
			}
			return Promise.resolve();
		},
		flush() {
			flushCount++;
			return Promise.resolve();
		},
		get sentCount() {
			return rows.length;
		},
		frozen() {
			return Promise.resolve();
		},
		conditionalFormat(...args: unknown[]) {
			conditionalFormatCalls.push(args);
			return Promise.resolve();
		},
		getColNumByHeaderName(name: string) {
			const index = headers.indexOf(name);
			if (index === -1) {
				throw new Error(`createMockSheet: unknown header "${name}"`);
			}
			return index + 1;
		},
		hideCol() {
			return Promise.resolve();
		},
		overwriteHeaderFormat() {
			return Promise.resolve();
		},
	} as unknown as Sheet;

	return {
		sheet,
		rows,
		get flushCount() {
			return flushCount;
		},
		get headers() {
			return headers;
		},
		conditionalFormatCalls,
	};
}
