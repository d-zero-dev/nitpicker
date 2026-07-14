import type { ContentTypeCategory } from './types.js';

import { PHASE_6B_CONTENT_TYPE_RULES } from './content-type-rules.js';

/**
 * Classifies a raw HTTP `Content-Type` header value into the same coarse
 * categories used by the viewer read-model. The rule table in
 * `content-type-rules.ts` is evaluated in declared order and the first
 * matching rule wins (so `application/xhtml+xml` → `html` and
 * `image/svg+xml` → `image`).
 *
 * `null` / empty / whitespace-only inputs map to `'unknown'`; MIMEs that
 * fail every rule map to `'other'`. Behaviour mirrors
 * `@nitpicker/query`'s `classifyContentType`; see the type header of
 * `content-type-rules.ts` for the drift-warning contract.
 * @param contentType - The raw `Content-Type` header value, or `null`.
 * @returns The canonical category label.
 */
export function classifyContentType(contentType: string | null): ContentTypeCategory {
	if (contentType == null) {
		return 'unknown';
	}
	const semi = contentType.indexOf(';');
	const head = (semi === -1 ? contentType : contentType.slice(0, semi))
		.trim()
		.toLowerCase();
	if (head === '') {
		return 'unknown';
	}
	for (const rule of PHASE_6B_CONTENT_TYPE_RULES) {
		for (const matcher of rule.matchers) {
			switch (matcher.kind) {
				case 'exact': {
					if (head === matcher.value) {
						return rule.category;
					}
					break;
				}
				case 'prefix': {
					if (head.startsWith(matcher.value)) {
						return rule.category;
					}
					break;
				}
				case 'suffix': {
					if (head.endsWith(matcher.value)) {
						return rule.category;
					}
					break;
				}
			}
		}
	}
	return 'other';
}
