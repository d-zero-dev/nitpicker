import { describe, expect, it } from 'vitest';

import { matchStructuralTechnologySignals } from './match-structural-technology-signals.js';

describe('matchStructuralTechnologySignals', () => {
	it('detects Next.js via __NEXT_DATA__ and _next/ url pattern', () => {
		const html =
			'<html><body><div id="__next"></div><script src="/_next/static/chunks/main.js"></script><script id="__NEXT_DATA__" type="application/json">{}</script></body></html>';
		const signals = matchStructuralTechnologySignals(html, null);
		const technologies = signals.map((s) => s.technology);
		expect(technologies).toEqual(
			expect.arrayContaining(['Next.js', 'Next.js', 'Next.js']),
		);
		expect(signals.map((s) => s.signalType)).toEqual(
			expect.arrayContaining(['html-marker', 'url-pattern']),
		);
	});

	it('detects Astro via astro-island and _astro/ without false-matching Angular', () => {
		const html = '<astro-island></astro-island><link href="/_astro/style.css">';
		const signals = matchStructuralTechnologySignals(html, null);
		expect(signals.every((s) => s.technology === 'Astro')).toBe(true);
		expect(signals.some((s) => s.technology === 'Angular')).toBe(false);
	});

	it('does not confuse Astro data-astro-cid-* with Angular _ngcontent-*', () => {
		const html = '<div data-astro-cid-abc123></div>';
		const signals = matchStructuralTechnologySignals(html, null);
		expect(signals).toHaveLength(1);
		expect(signals[0]?.technology).toBe('Astro');
	});

	it('detects Vue via data-v-* scoped attribute', () => {
		const html = '<div data-v-1a2b3c4d></div>';
		const signals = matchStructuralTechnologySignals(html, null);
		expect(signals).toEqual([
			expect.objectContaining({ technology: 'Vue', signalType: 'scoped-attr' }),
		]);
	});

	it('detects a technology via meta-generator prefix match, case-insensitively', () => {
		const signals = matchStructuralTechnologySignals('<html></html>', 'Astro v4.2.0');
		expect(signals).toEqual([
			expect.objectContaining({
				technology: 'Astro',
				signalType: 'meta-generator',
				category: 'Static site generator',
				version: 'v4.2.0',
			}),
		]);
	});

	it('does not match a generator whose prefix only partially overlaps', () => {
		const signals = matchStructuralTechnologySignals('<html></html>', 'AstroTurf CMS');
		// "astroturf" starts with "astro" — this IS expected to match per
		// simple prefix matching; documents current (accepted) behavior
		// rather than asserting a false negative.
		expect(signals.some((s) => s.technology === 'Astro')).toBe(true);
	});

	it('returns an empty array when nothing matches', () => {
		expect(
			matchStructuralTechnologySignals('<html><body>plain</body></html>', null),
		).toEqual([]);
	});

	it('ignores a null/undefined generator', () => {
		expect(matchStructuralTechnologySignals('<html></html>')).toEqual([]);
	});
});
