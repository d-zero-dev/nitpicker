import { describe, expect, it } from 'vitest';

import { convertTagRowToWappalyzerSignal } from './convert-tag-row-to-wappalyzer-signal.js';

describe('convertTagRowToWappalyzerSignal', () => {
	it('converts a legacy page_tags row with JSON-string categories (raw SQL read)', () => {
		const signal = convertTagRowToWappalyzerSignal({
			provider: 'Vue.js',
			version: '3.4.0',
			confidence: 100,
			categories: '["JavaScript frameworks"]',
		});
		expect(signal).toEqual({
			technology: 'Vue',
			signalType: 'wappalyzer',
			evidence: 'Vue.js',
			weight: 100,
			category: 'JavaScript frameworks',
			version: '3.4.0',
		});
	});

	it('converts a legacy page_tags row with already-parsed array categories', () => {
		const signal = convertTagRowToWappalyzerSignal({
			provider: 'Google Analytics',
			version: null,
			confidence: null,
			categories: ['Analytics'],
		});
		expect(signal.technology).toBe('Google Analytics');
		expect(signal.weight).toBe(60);
		expect(signal.category).toBe('Analytics');
	});

	it('falls back to an empty category list for malformed JSON', () => {
		const signal = convertTagRowToWappalyzerSignal({
			provider: 'jQuery',
			version: null,
			confidence: null,
			categories: 'not json',
		});
		expect(signal.category).toBeNull();
	});

	it('falls back to an empty category list for null categories', () => {
		const signal = convertTagRowToWappalyzerSignal({
			provider: 'jQuery',
			version: null,
			confidence: null,
			categories: null,
		});
		expect(signal.category).toBeNull();
	});
});
