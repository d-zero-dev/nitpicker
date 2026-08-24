/**
 * Safety cap for a joined URL list inserted into a cell note. Google Sheets
 * caps cell content / notes around 50,000 characters; this stays well below
 * that to leave room for the "and N more" suffix.
 */
export const NOTE_MAX_LENGTH = 49_000;

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
