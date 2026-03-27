import type { Cell } from '@d-zero/google-sheets';

/**
 * Maps a {@link Cell} to a plain string for TSV export using {@link Cell.provide}.
 * Dates become serial numbers; hyperlinks and images become formula strings,
 * matching the Google Sheets cell representation.
 * @param cell - Spreadsheet cell from the report pipeline.
 * @returns Plain-text field value (never `null`; empty when undefined).
 */
export function cellToPlainString(cell: Cell): string {
	const { userEnteredValue: ue } = cell.provide();
	if (!ue) {
		return '';
	}
	if ('stringValue' in ue && ue.stringValue != null) {
		return ue.stringValue;
	}
	if ('numberValue' in ue && ue.numberValue != null) {
		return String(ue.numberValue);
	}
	if ('boolValue' in ue && ue.boolValue != null) {
		return ue.boolValue ? 'TRUE' : 'FALSE';
	}
	if ('formulaValue' in ue && ue.formulaValue != null) {
		return ue.formulaValue;
	}
	return '';
}
