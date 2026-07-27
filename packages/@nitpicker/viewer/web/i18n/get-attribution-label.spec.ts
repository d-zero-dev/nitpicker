import type { FailureAttribution } from '@nitpicker/query';

import { describe, expect, it } from 'vitest';

import { getAttributionLabel } from './get-attribution-label.js';

/**
 * Build a stub translate fn that returns whatever `dictionary` maps to and
 * falls back to the key itself when missing — mirroring the real `t()`.
 * @param dictionary - key → label mapping.
 * @returns A translate function compatible with {@link getAttributionLabel}.
 */
function tStub(dictionary: Record<string, string>) {
	return (key: string) => dictionary[key] ?? key;
}

describe('getAttributionLabel', () => {
	it('looks up the localised label via `views.attribution.<attribution>`', () => {
		const t = tStub({
			'views.attribution.site': 'Target site',
			'views.attribution.network': 'Your network',
		});
		expect(getAttributionLabel('site', t)).toBe('Target site');
		expect(getAttributionLabel('network', t)).toBe('Your network');
	});

	it('falls back to the raw attribution when no translation is registered', () => {
		const t = tStub({});
		expect(getAttributionLabel('site', t)).toBe('site');
	});

	it('covers every value in the FailureAttribution union', () => {
		const attributions: FailureAttribution[] = ['site', 'network'];
		const t = tStub({});
		for (const attribution of attributions) {
			expect(getAttributionLabel(attribution, t)).toBe(attribution);
		}
	});
});
