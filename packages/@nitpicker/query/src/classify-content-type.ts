import type { ContentTypeCategory } from './types.js';

import { CONTENT_TYPE_RULES, matchesMime } from './content-type-rules.js';

/**
 * Strips MIME parameters (`; charset=...`, `; boundary=...`) from a raw
 * Content-Type header and normalises the resulting media type to a canonical
 * (trimmed, lower-cased) form.
 *
 * Equivalent to running `normalizeContentType` from `@nitpicker/crawler`
 * over the part before the first `;` — duplicated here to keep
 * `@nitpicker/query` browser-import-safe (it can't depend on the
 * Node-only crawler runtime).
 * @param contentType - The raw header value, or `null`.
 * @returns The canonical MIME, or `null` when blank / null.
 */
function normalizeMime(contentType: string | null): string | null {
	if (contentType == null) {
		return null;
	}
	const semi = contentType.indexOf(';');
	const head = (semi === -1 ? contentType : contentType.slice(0, semi))
		.trim()
		.toLowerCase();
	return head === '' ? null : head;
}

/**
 * Classifies a raw HTTP `Content-Type` header value into one of the canonical
 * coarse-grained categories used by the viewer summary / filter UI.
 *
 * The rule table in `content-type-rules.ts` is the single source of truth —
 * this function evaluates rules in declared order and returns the first
 * match. `null` / empty / blank inputs map to `'unknown'`; anything that
 * fails every rule maps to `'other'`.
 *
 * `application/xhtml+xml` resolves to `'html'` (not `'xml'`) and
 * `image/svg+xml` resolves to `'image'` (not `'xml'`) because the rule table
 * places those categories earlier — and the matching SQL filter in
 * `applyCategoryFilter` honours the same precedence by subtracting earlier
 * rules.
 * @param contentType - The raw `Content-Type` header value, or `null`.
 * @returns The canonical category.
 */
export function classifyContentType(contentType: string | null): ContentTypeCategory {
	const mime = normalizeMime(contentType);
	if (mime === null) {
		return 'unknown';
	}
	for (const rule of CONTENT_TYPE_RULES) {
		if (rule.matchers.some((m) => matchesMime(mime, m))) {
			return rule.category;
		}
	}
	return 'other';
}

/**
 * Ordered list of every {@link ContentTypeCategory}. Useful for iterating
 * categories in stable display order or producing typed lookups.
 *
 * Derives from the central {@link CONTENT_TYPE_RULES} table, then appends
 * the two fall-through buckets (`'other'`, `'unknown'`) that live outside
 * the rule table.
 */
export const CONTENT_TYPE_CATEGORIES: readonly ContentTypeCategory[] = [
	...CONTENT_TYPE_RULES.map((r) => r.category),
	'other',
	'unknown',
] as const;
