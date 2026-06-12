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
});
