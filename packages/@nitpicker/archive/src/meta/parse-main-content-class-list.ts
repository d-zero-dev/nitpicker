/**
 * Decodes the `page_meta.main_content_class_list` column — the detected
 * main-content element's CSS classes, stored as a JSON array — shared by
 * `Page.mainContentClassList` and template classification's page loader so
 * both read the column the same way.
 *
 * The crawler writes the column with `JSON.stringify` on a string array, so
 * anything else is a corrupt archive; it throws rather than guessing, since
 * a silently dropped class list would change which template a page lands in.
 * @param raw - The column value; `null` when no main region was detected.
 * @returns The class names, or `null` when no main region was detected.
 * @throws {Error} When the value is not a JSON array of strings.
 * @example
 * ```ts
 * parseMainContentClassList('["spc","wide"]'); // ['spc', 'wide']
 * parseMainContentClassList(null); // null
 * ```
 */
export function parseMainContentClassList(raw: string | null): string[] | null {
	if (raw === null) {
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(`main_content_class_list is not valid JSON: ${raw}`);
	}
	if (!Array.isArray(parsed) || parsed.some((name) => typeof name !== 'string')) {
		throw new Error(`main_content_class_list is not a JSON array of strings: ${raw}`);
	}
	return parsed as string[];
}
