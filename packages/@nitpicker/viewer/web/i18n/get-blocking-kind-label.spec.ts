import { describe, expect, it } from 'vitest';

import { getBlockingKindLabel } from './get-blocking-kind-label.js';

/**
 * Build a stub translate fn that returns whatever `dictionary` maps to and
 * falls back to the key itself when missing — mirroring the real `t()`.
 * @param dictionary - key → label mapping.
 * @returns A translate function compatible with {@link getBlockingKindLabel}.
 */
function tStub(dictionary: Record<string, string>) {
	return (key: string) => dictionary[key] ?? key;
}

describe('getBlockingKindLabel', () => {
	it('looks up the localised label via `views.templateClusterBlockingKind.<kind>`', () => {
		const t = tStub({ 'views.templateClusterBlockingKind.css': 'CSS' });
		expect(getBlockingKindLabel('css', t)).toBe('CSS');
	});

	it('falls back to the raw kind when no translation is registered', () => {
		const t = tStub({});
		expect(getBlockingKindLabel('path', t)).toBe('path');
	});

	it('covers every kind in the BlockingReason union', () => {
		const t = tStub({});
		for (const kind of ['css', 'path', 'orphanMerge'] as const) {
			expect(getBlockingKindLabel(kind, t)).toBe(kind);
		}
	});
});
