import { CONTENT_TYPE_CATEGORIES } from '@nitpicker/query/categories';
import { describe, expect, it } from 'vitest';

import { translations } from './translations.js';

/**
 * Flattens a nested translation object into `[dotKeyPath, value]` leaf entries
 * (e.g. `['views.pages.colTitle', 'Title']`), sorted by key path. A leaf is any
 * non-object value.
 * @param source - The (possibly nested) translation record.
 * @param prefix - The accumulated key prefix (internal recursion state).
 * @returns The sorted leaf entries.
 */
function leafEntries(source: Record<string, unknown>, prefix = ''): [string, unknown][] {
	const entries: [string, unknown][] = [];
	for (const [key, value] of Object.entries(source)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (value !== null && typeof value === 'object') {
			entries.push(...leafEntries(value as Record<string, unknown>, path));
		} else {
			entries.push([path, value]);
		}
	}
	return entries.toSorted(([a], [b]) => a.localeCompare(b));
}

describe('translations', () => {
	it('en と ja のキー集合が完全に一致する（片方の追加漏れを防ぐ）', () => {
		// Mismatched keys silently fall back to the raw key string at runtime
		// (e.g. an untranslated label renders as "common.skipToContent"), so the
		// two locales must always define the exact same leaf paths.
		const enKeys = leafEntries(translations.en).map(([path]) => path);
		const jaKeys = leafEntries(translations.ja).map(([path]) => path);
		expect(jaKeys).toEqual(enKeys);
	});

	it('en の全ての翻訳値が非空の文字列である', () => {
		const offenders = leafEntries(translations.en).filter(
			([, value]) => typeof value !== 'string' || value.length === 0,
		);
		expect(offenders).toEqual([]);
	});

	it('ja の全ての翻訳値が非空の文字列である', () => {
		const offenders = leafEntries(translations.ja).filter(
			([, value]) => typeof value !== 'string' || value.length === 0,
		);
		expect(offenders).toEqual([]);
	});

	/* The stacked-bar legend renders `views.contentType.<category>` for every
	   ContentTypeCategory. Without this check, adding a new category in
	   `@nitpicker/query` (and a matching `.bar-segment-<new>` CSS rule that
	   `content-type-class.spec.ts` enforces) still leaves the legend showing
	   the raw key path because `t()` falls back to the key on miss. This
	   spec is the i18n half of the same coverage net. */
	it('views.contentType に全 ContentTypeCategory のラベルが定義されている', () => {
		for (const locale of ['en', 'ja'] as const) {
			const flat = new Map(leafEntries(translations[locale]));
			for (const category of CONTENT_TYPE_CATEGORIES) {
				const key = `views.contentType.${category}`;
				const label = flat.get(key);
				expect(label, `missing ${locale}.${key}`).toBeTypeOf('string');
				expect((label as string).length, `empty ${locale}.${key}`).toBeGreaterThan(0);
			}
		}
	});
});
