import { describe, expect, it } from 'vitest';

import { getLandmarkTypeLabel } from './get-landmark-type-label.js';

/**
 * Build a stub translate fn that returns whatever `dictionary` maps to and
 * falls back to the key itself when missing — mirroring the real `t()`.
 * @param dictionary - key → label mapping.
 * @returns A translate function compatible with {@link getLandmarkTypeLabel}.
 */
function tStub(dictionary: Record<string, string>) {
	return (key: string) => dictionary[key] ?? key;
}

describe('getLandmarkTypeLabel', () => {
	it('looks up the localised label via `views.landmarkType.<type>`', () => {
		const t = tStub({ 'views.landmarkType.header': 'ヘッダー' });
		expect(getLandmarkTypeLabel('header', t)).toBe('ヘッダー');
	});

	it('falls back to the raw type when no translation is registered', () => {
		const t = tStub({});
		expect(getLandmarkTypeLabel('nav', t)).toBe('nav');
	});

	it('covers every type in the landmark type union', () => {
		const t = tStub({});
		for (const type of ['header', 'footer', 'nav', 'aside', 'form', 'search'] as const) {
			expect(getLandmarkTypeLabel(type, t)).toBe(type);
		}
	});
});
