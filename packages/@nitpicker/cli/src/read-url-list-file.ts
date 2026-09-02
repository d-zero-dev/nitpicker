import type { ListItem } from '@d-zero/readtext/list';

import fs from 'node:fs/promises';

import { toListWithPosition } from '@d-zero/readtext/list';

import { classifyInventoryListItems } from './crawl/classify-inventory-list-items.js';

/** Result of {@link readUrlListFile}. */
export interface UrlListFile {
	/** Lines that passed URL validation, in source order. */
	readonly urls: string[];
	/** Lines that failed URL validation, retaining their line/column position. */
	readonly invalid: ListItem[];
	/**
	 * The exact bytes read from `filePath`. Callers that archive the source
	 * list verbatim (`--inventory`, `--recrawl`) or content-hash it
	 * (`computeFileSha256`) use this instead of re-reading the file — the
	 * same buffer that fed classification is what gets hashed/archived, so
	 * the two can never observe a file that changed between calls.
	 */
	readonly bytes: Buffer;
}

/**
 * Reads a newline-delimited URL list file and classifies each line as a
 * valid or invalid URL.
 *
 * Shared entry point for the CLI's `crawl --inventory` and `--recrawl`
 * dispatch functions — the only URL-list-consuming code that needs a
 * dependency on `@d-zero/readtext`, keeping that dependency confined to this
 * package rather than every package that accepts a URL list.
 *
 * Lines are split by `toListWithPosition` (`@d-zero/readtext/list`), which
 * strips blank lines and `#` comments while keeping each surviving line's
 * source position — the same convention `--list-file` uses. This function
 * does not decide what to do about an empty file or an all-invalid list;
 * that judgment (and the operator-facing wording) belongs to each command's
 * own dispatch function, which knows the flag name and usage message to
 * report.
 * @param filePath - Path to the URL list file, already resolved by the caller.
 * @returns The valid URLs, the invalid lines with their position, and the
 *   raw file bytes.
 * @example
 * ```ts
 * const { urls, invalid, bytes } = await readUrlListFile(resolvedPath);
 * if (invalid.length > 0) {
 *   console.warn(formatInvalidRecrawlUrlWarning(listFile, invalid[0]));
 * }
 * ```
 */
export async function readUrlListFile(filePath: string): Promise<UrlListFile> {
	const bytes = await fs.readFile(filePath);
	const items = toListWithPosition(bytes.toString('utf8'));
	const { valid, invalid } = classifyInventoryListItems(items);
	return { urls: valid, invalid, bytes };
}
