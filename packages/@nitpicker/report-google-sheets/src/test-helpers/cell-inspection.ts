/** A `Cell`-shaped value with a callable, no-argument-required `provide()`. */
interface InspectableCell {
	provide: (n?: number) => { userEnteredValue: Record<string, unknown>; note?: string };
}

/**
 * Extracts the primitive value from a Cell by calling `provide()` and reading `userEnteredValue`.
 * @param cell - A Cell object with a `provide` method.
 * @returns The string, number, boolean, or formula value held by the cell.
 */
export function cellValue(cell: InspectableCell): unknown {
	const provided = cell.provide();
	return (
		provided.userEnteredValue.stringValue ??
		provided.userEnteredValue.numberValue ??
		provided.userEnteredValue.boolValue ??
		provided.userEnteredValue.formulaValue ??
		''
	);
}

/**
 * Extracts the note string from a Cell by calling `provide()`.
 * @param cell - A Cell object with a `provide` method.
 * @returns The note attached to the cell, or `undefined`.
 */
export function cellNote(cell: InspectableCell): string | undefined {
	return cell.provide().note;
}
