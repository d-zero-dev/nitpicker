import { NOTE_MAX_LENGTH } from './join-urls-for-note.js';

/**
 * Truncates an arbitrary, already-built note string to `maxLength`,
 * appending a truncation marker when truncation actually happens. Sibling
 * to {@link joinUrlsForNote} for note content that isn't a list of URLs (a
 * page title, a JSON blob, a plugin-supplied free-text note) — both share
 * the same {@link NOTE_MAX_LENGTH} ceiling so every note this package
 * writes stays under `Cell.provide()`'s hard cut (see `NOTE_MAX_LENGTH`'s
 * docs).
 * @param text - The full note text.
 * @param maxLength - Optional override (defaults to {@link NOTE_MAX_LENGTH}).
 * @example
 * truncateNoteText('a'.repeat(10_000), 100);
 * // 'aaaa...aaaa\n\n...(truncated: showing first 100 of 10000 characters)'
 */
export function truncateNoteText(
	text: string,
	maxLength: number = NOTE_MAX_LENGTH,
): string {
	if (text.length <= maxLength) {
		return text;
	}
	const suffix = `\n\n...(truncated: showing first ${maxLength} of ${text.length} characters)`;
	const keepLength = Math.max(0, maxLength - suffix.length);
	return text.slice(0, keepLength) + suffix;
}
