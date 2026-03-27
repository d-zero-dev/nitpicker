import type { ReportSheetTab, ReportSpreadsheet } from './types.js';
import type { Cell } from '@d-zero/google-sheets';
import type { sheets_v4 } from 'googleapis';

/**
 * Per-tab in-memory buffer: header row plus appended data rows.
 */
interface TabBufferState {
	/** First-row header labels; filled when `ReportSheetTab.setHeaders` runs. */
	headers: string[];
	/** Data rows (excluding the header row). */
	rows: Cell[][];
}

/**
 * In-memory `ReportSpreadsheet` used by `createSheets` for TSV export.
 * Reuses the same `TabBufferState` for a given tab title across all phases.
 */
export class BufferedSpreadsheet implements ReportSpreadsheet {
	/** Tab title → accumulated headers and rows. */
	readonly #tabs = new Map<string, TabBufferState>();

	/**
	 * Opens a tab handle that reads and writes the shared buffer for the given title.
	 * @param title - Sheet tab name.
	 */
	create(title: string): Promise<ReportSheetTab> {
		const state = this.#getOrCreateState(title);
		return Promise.resolve(new BufferedSheetTab(state));
	}

	/**
	 * Returns a read-only view of buffered tabs after `createSheets` completes.
	 */
	getTabSnapshots(): ReadonlyMap<string, Readonly<TabBufferState>> {
		return this.#tabs;
	}

	/**
	 * Returns or creates the backing state for a tab title.
	 * @param title - Sheet tab name.
	 */
	#getOrCreateState(title: string): TabBufferState {
		let state = this.#tabs.get(title);
		if (!state) {
			state = { headers: [], rows: [] };
			this.#tabs.set(title, state);
		}
		return state;
	}
}

/**
 * `ReportSheetTab` implementation that mutates a shared `TabBufferState`.
 */
class BufferedSheetTab implements ReportSheetTab {
	readonly #state: TabBufferState;

	/**
	 * @param state - Shared buffer for this tab (must outlive this handle).
	 */
	constructor(state: TabBufferState) {
		this.#state = state;
	}

	/** @inheritdoc */
	addRowData(data: Cell[][], next?: boolean): Promise<void> {
		void next;
		for (const row of data) {
			this.#state.rows.push([...row]);
		}
		return Promise.resolve();
	}

	/** @inheritdoc */
	conditionalFormat(
		targetCols: number[],
		rule: sheets_v4.Schema$ConditionalFormatRule,
	): Promise<void> {
		void targetCols;
		void rule;
		return Promise.resolve();
	}

	/** @inheritdoc */
	frozen(col: number, row: number): Promise<void> {
		void col;
		void row;
		return Promise.resolve();
	}

	/** @inheritdoc */
	getColNumByHeaderName(name: string): number {
		const index = this.#state.headers.indexOf(name);
		if (index === -1) {
			throw new Error(`BufferedSpreadsheet: unknown header "${name}"`);
		}
		return index + 1;
	}

	/** @inheritdoc */
	hideCol(colNum: number): Promise<void> {
		void colNum;
		return Promise.resolve();
	}

	/** @inheritdoc */
	overwriteHeaderFormat(): Promise<void> {
		return Promise.resolve();
	}

	/** @inheritdoc */
	setHeaders(headers: string[]): Promise<void> {
		this.#state.headers = [...headers];
		return Promise.resolve();
	}
}
