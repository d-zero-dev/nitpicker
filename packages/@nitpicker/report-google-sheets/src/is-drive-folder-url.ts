import { parseGoogleUrl } from '@d-zero/google-sheets';

/**
 * Whether `sheetUrl` is a Drive folder URL, i.e. whether `report` must create the
 * Spreadsheet (which needs the Drive OAuth scope) instead of writing to an existing one.
 * @param sheetUrl - The `--sheet` value.
 * @returns `true` for `https://drive.google.com/drive/folders/<id>`-style URLs.
 * @example
 * ```ts
 * isDriveFolderUrl('https://drive.google.com/drive/folders/abc123'); //=> true
 * isDriveFolderUrl('https://docs.google.com/spreadsheets/d/xyz/edit'); //=> false
 * ```
 */
export function isDriveFolderUrl(sheetUrl: string): boolean {
	return parseGoogleUrl(sheetUrl)?.kind === 'drive-folder';
}
