import type { TagEntry } from '@d-zero/beholder';

import { describe, expect, it } from 'vitest';

import { normalizeWappalyzerEntries } from './normalize-wappalyzer-entries.js';

describe('normalizeWappalyzerEntries', () => {
	it('returns an empty array for undefined entries', () => {
		expect(normalizeWappalyzerEntries()).toEqual([]);
	});

	it('returns an empty array for empty entries', () => {
		expect(normalizeWappalyzerEntries([])).toEqual([]);
	});

	it('folds a curated framework provider onto its structural-signal technology name', () => {
		const entries: TagEntry[] = [
			{
				provider: 'Vue.js',
				categories: ['JavaScript frameworks'],
				version: '3.4.0',
				confidence: 100,
				sources: [],
			},
		];
		const [signal] = normalizeWappalyzerEntries(entries);
		expect(signal).toEqual({
			technology: 'Vue',
			signalType: 'wappalyzer',
			evidence: 'Vue.js',
			weight: 100,
			category: 'JavaScript frameworks',
			version: '3.4.0',
		});
	});

	it('passes an uncurated provider through verbatim as its own technology', () => {
		const entries: TagEntry[] = [
			{
				provider: 'Google Analytics',
				categories: ['Analytics'],
				id: 'G-XXXX',
				sources: [],
			},
		];
		const [signal] = normalizeWappalyzerEntries(entries);
		expect(signal?.technology).toBe('Google Analytics');
		expect(signal?.evidence).toBe('G-XXXX');
	});

	it('falls back to the default weight when confidence is absent', () => {
		const entries: TagEntry[] = [
			{ provider: 'jQuery', categories: ['JavaScript libraries'], sources: [] },
		];
		const [signal] = normalizeWappalyzerEntries(entries);
		expect(signal?.weight).toBe(60);
	});

	it('converts multiple entries independently', () => {
		const entries: TagEntry[] = [
			{ provider: 'Next.js', categories: [], sources: [] },
			{ provider: 'Google Tag Manager', categories: ['Tag managers'], sources: [] },
		];
		const signals = normalizeWappalyzerEntries(entries);
		expect(signals).toHaveLength(2);
		expect(signals[0]?.technology).toBe('Next.js');
		expect(signals[1]?.technology).toBe('Google Tag Manager');
	});
});
