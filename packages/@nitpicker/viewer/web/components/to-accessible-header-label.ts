/**
 * Resolves a TanStack column `header` into a stable accessible name.
 *
 * When the header is a non-empty plain string it is returned as-is, so it can be
 * pinned to the `<th>` via `aria-label` — this stops a focusable resize
 * separator (a descendant of the header cell) from leaking its own label into
 * the column header's computed name (e.g. "Title, Resize column…"). For
 * non-string headers (custom JSX renderers) or empty strings there is no
 * reliable text, so `undefined` is returned and the browser falls back to
 * name-from-content instead of setting an empty/meaningless `aria-label`.
 * @param header - The column definition's `header` value (a string or a render template).
 * @returns The header string when it is a non-empty plain string, else `undefined`.
 */
export function toAccessibleHeaderLabel(header: unknown): string | undefined {
	return typeof header === 'string' && header.length > 0 ? header : undefined;
}
