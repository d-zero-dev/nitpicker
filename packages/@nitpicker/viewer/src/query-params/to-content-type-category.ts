import type { ContentTypeCategory } from '@nitpicker/query';

import { CONTENT_TYPE_CATEGORIES } from '@nitpicker/query';

/**
 * Parses a raw query-string value into a {@link ContentTypeCategory}.
 *
 * Without this guard, an un-validated string would reach `applyCategoryFilter`,
 * whose matcher-table lookup returns `undefined` for unknown keys — the
 * subsequent invocation throws `TypeError: ... is not a function`, surfacing
 * to MCP / curl / stale-bookmark clients as an opaque 500.
 *
 * The function returns `undefined` for missing or unrecognised values,
 * matching the silent-drop convention used by `toBoolean` / `toNumber` in
 * the same directory — an HTTP-route caller that supplies a stale category
 * gets the un-filtered list rather than an error. CLI (`map-flags-to-query-
 * options`) and MCP (JSON schema enum) reject the same input loudly, which
 * fits their typed-input UX.
 * @param raw - The raw query-string value.
 * @returns The narrowed category or `undefined`.
 */
export function toContentTypeCategory(
	raw: string | undefined,
): ContentTypeCategory | undefined {
	if (!raw) {
		return undefined;
	}
	return (CONTENT_TYPE_CATEGORIES as readonly string[]).includes(raw)
		? (raw as ContentTypeCategory)
		: undefined;
}
