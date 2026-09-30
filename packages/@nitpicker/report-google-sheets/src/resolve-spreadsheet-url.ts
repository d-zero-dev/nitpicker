import path from 'node:path';

import { createSpreadsheet } from '@d-zero/google-sheets';

import { isDriveFolderUrl } from './is-drive-folder-url.js';

/**
 * Parameters for {@link resolveSpreadsheetUrl}.
 */
export interface ResolveSpreadsheetUrlParams {
	/** The `--sheet` value: a Spreadsheet URL, or a Drive folder URL to create one in. */
	readonly sheetUrl: string;
	/** Path to the `.nitpicker` archive; its file name (without extension) titles a created Spreadsheet. */
	readonly archiveFilePath: string;
	/** Authenticated client. Must carry the Drive scope when `sheetUrl` is a Drive folder URL. */
	readonly auth: Parameters<typeof createSpreadsheet>[2];
}

/**
 * Resolves the Spreadsheet URL the report should be written to.
 *
 * - **Drive folder URL** (`https://drive.google.com/drive/folders/<id>`): creates a
 *   new Spreadsheet in that folder, titled with the archive's file name minus its
 *   `.nitpicker` extension, and returns its edit URL. Every call creates a new
 *   file — `createSpreadsheet` neither searches for a same-named one nor retries
 *   (`files.create` is non-idempotent).
 * - **Anything else** (including URLs `parseGoogleUrl` does not recognize): returned
 *   unchanged, so the existing "write into this Spreadsheet" behavior — and its
 *   error reporting for a malformed URL — is untouched.
 *
 * The caller decides which OAuth scopes to request with `isDriveFolderUrl` before
 * authenticating, so users who pass a Spreadsheet URL are never asked to
 * re-authorize for Drive access.
 * @param params - See {@link ResolveSpreadsheetUrlParams}.
 * @returns The Spreadsheet URL to write to.
 * @example
 * ```ts
 * const url = await resolveSpreadsheetUrl({
 *   sheetUrl: 'https://drive.google.com/drive/folders/abc123',
 *   archiveFilePath: './example.com.nitpicker',
 *   auth,
 * });
 * // Creates "example.com" in the folder and returns its edit URL.
 * ```
 */
export async function resolveSpreadsheetUrl(
	params: ResolveSpreadsheetUrlParams,
): Promise<string> {
	const { sheetUrl, archiveFilePath, auth } = params;
	if (!isDriveFolderUrl(sheetUrl)) {
		return sheetUrl;
	}
	const title = path.basename(archiveFilePath, '.nitpicker');
	try {
		const { url } = await createSpreadsheet(sheetUrl, title, auth);
		return url;
	} catch (error) {
		// An OAuth token cached by an earlier run only carries the scopes it was
		// granted with, and `@d-zero/google-auth` never re-prompts for a cached
		// token — the resulting 403 is opaque without this pointer.
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Failed to create a Spreadsheet in the Drive folder: ${reason}\n` +
				'If this is a permission error, delete token.json and re-run to authorize Drive access.',
			{ cause: error },
		);
	}
}
