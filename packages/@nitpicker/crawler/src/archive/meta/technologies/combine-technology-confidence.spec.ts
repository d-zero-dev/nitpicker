import type { TechnologySignalPartial } from './types.js';

import { describe, expect, it } from 'vitest';

import { combineTechnologyConfidence } from './combine-technology-confidence.js';

describe('combineTechnologyConfidence', () => {
	it('a single signal resolves to its own weight exactly', () => {
		const signals: TechnologySignalPartial[] = [
			{ technology: 'Next.js', signalType: 'html-marker', evidence: 'x', weight: 70 },
		];
		const [result] = combineTechnologyConfidence(signals);
		expect(result?.confidence).toBe(70);
		expect(result?.signalCount).toBe(1);
	});

	it('compounds confidence across distinct signal types via noisy-OR', () => {
		const signals: TechnologySignalPartial[] = [
			{ technology: 'Next.js', signalType: 'html-marker', evidence: 'a', weight: 60 },
			{ technology: 'Next.js', signalType: 'url-pattern', evidence: 'b', weight: 50 },
		];
		const [result] = combineTechnologyConfidence(signals);
		// 1 - (1-0.6)(1-0.5) = 0.8
		expect(result?.confidence).toBe(80);
		expect(result?.signalCount).toBe(2);
	});

	it('does not double-count two signals of the same type — keeps only the max weight', () => {
		const signals: TechnologySignalPartial[] = [
			{ technology: 'Astro', signalType: 'url-pattern', evidence: 'a', weight: 30 },
			{ technology: 'Astro', signalType: 'url-pattern', evidence: 'b', weight: 50 },
		];
		const [result] = combineTechnologyConfidence(signals);
		expect(result?.confidence).toBe(50);
		expect(result?.signalCount).toBe(1);
	});

	it('groups independently per technology', () => {
		const signals: TechnologySignalPartial[] = [
			{ technology: 'Next.js', signalType: 'html-marker', evidence: 'a', weight: 70 },
			{ technology: 'Vue', signalType: 'scoped-attr', evidence: 'b', weight: 40 },
		];
		const results = combineTechnologyConfidence(signals);
		expect(results).toHaveLength(2);
		expect(results.find((r) => r.technology === 'Next.js')?.confidence).toBe(70);
		expect(results.find((r) => r.technology === 'Vue')?.confidence).toBe(40);
	});

	it('drops technologies whose combined confidence falls below the threshold', () => {
		const signals: TechnologySignalPartial[] = [
			{ technology: 'Vue', signalType: 'weak-marker', evidence: 'id="app"', weight: 15 },
		];
		expect(combineTechnologyConfidence(signals)).toEqual([]);
	});

	it('prefers a wappalyzer-sourced category/version over other signal types', () => {
		const signals: TechnologySignalPartial[] = [
			{
				technology: 'Astro',
				signalType: 'url-pattern',
				evidence: 'a',
				weight: 50,
				category: 'Static site generator',
			},
			{
				technology: 'Astro',
				signalType: 'wappalyzer',
				evidence: 'Astro',
				weight: 60,
				category: 'Static Site Generator',
				version: '4.2.0',
			},
		];
		const [result] = combineTechnologyConfidence(signals);
		expect(result?.category).toBe('Static Site Generator');
		expect(result?.version).toBe('4.2.0');
	});

	it('falls back to null category/version when no signal supplies one', () => {
		const signals: TechnologySignalPartial[] = [
			{ technology: 'Next.js', signalType: 'html-marker', evidence: 'a', weight: 70 },
		];
		const [result] = combineTechnologyConfidence(signals);
		expect(result?.category).toBeNull();
		expect(result?.version).toBeNull();
	});

	it('returns an empty array for no signals', () => {
		expect(combineTechnologyConfidence([])).toEqual([]);
	});

	it('skipThreshold keeps a technology whose confidence would otherwise be dropped', () => {
		const signals: TechnologySignalPartial[] = [
			{
				technology: 'Some CMS',
				signalType: 'wappalyzer',
				evidence: 'Some CMS',
				weight: 20,
			},
		];
		expect(combineTechnologyConfidence(signals)).toEqual([]);
		const [result] = combineTechnologyConfidence(signals, { skipThreshold: true });
		expect(result?.technology).toBe('Some CMS');
		expect(result?.confidence).toBe(20);
	});
});
