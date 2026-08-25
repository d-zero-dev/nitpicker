/**
 * Safety cap for a cell note produced by this package. `@d-zero/google-sheets`'s
 * `Cell.provide()` — which every `sheet.appendRow()` call goes through — hard-slices
 * any note longer than 5,000 characters (its `noteMaxLength` default) and appends
 * its own `"\n\n...\nToo Large Text"` marker. There is currently no call path from
 * this package (no `CellData`/`Sheet` option) that overrides that default, so any
 * note built above ~5,000 characters is silently re-cut by that layer regardless of
 * what this module does. Staying comfortably under that value ensures the
 * informative suffix this module builds (`"... and N more"` / a truncation notice)
 * is what actually reaches the spreadsheet, instead of being itself chopped
 * mid-string by `Cell.provide()`'s blunter default cut.
 */
export const NOTE_MAX_LENGTH = 4800;

/**
 * Joins URLs into a single newline-separated string, truncating at
 * `maxLength` to stay within Google Sheets' note size cap. When truncated,
 * appends a `... and N more` line where `N` counts every URL that did not
 * fit, including the one whose insertion would have crossed the limit.
 *
 * Shared by every sheet that shows a referrer/redirect-source URL list in a
 * cell note (Page List, Links, Resources) — previously duplicated per sheet
 * as `joinReferrersForNote`.
 * @param urls - The URLs to join, in display order. A `Set` (for
 *   already-deduplicated callers) or a plain array both work.
 * @param maxLength - Optional override for the character cap (defaults to {@link NOTE_MAX_LENGTH}).
 */
export function joinUrlsForNote(
	urls: Iterable<string>,
	maxLength: number = NOTE_MAX_LENGTH,
): string {
	const all = [...urls];
	const total = all.length;
	if (total === 0) {
		return '';
	}
	const kept: string[] = [];
	let used = 0;
	let seen = 0;
	for (const url of all) {
		seen++;
		const next = used + url.length + (kept.length > 0 ? 1 : 0);
		if (next > maxLength) {
			const remaining = total - seen + 1;
			kept.push(`... and ${remaining} more`);
			break;
		}
		kept.push(url);
		used = next;
	}
	return kept.join('\n');
}
