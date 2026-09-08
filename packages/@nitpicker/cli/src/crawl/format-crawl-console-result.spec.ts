import type { CrawlRuntimeOptions } from '@nitpicker/crawler';

import { describe, it, expect } from 'vitest';

import { formatCrawlConsoleResult } from './format-crawl-console-result.js';

const baseSnapshot: CrawlRuntimeOptions = {
	parallels: 4,
	interval: 0,
	excludes: ['/a/**', '/admin/**'],
	excludeUrls: [],
	excludeKeywords: [],
};

describe('formatCrawlConsoleResult', () => {
	it('formats a parallels change', () => {
		expect(formatCrawlConsoleResult({ parallels: 4 }, baseSnapshot)).toBe('parallels: 4');
	});

	it('formats an interval change', () => {
		expect(
			formatCrawlConsoleResult({ interval: 500 }, { ...baseSnapshot, interval: 500 }),
		).toBe('interval: 500ms');
	});

	it('formats an exclude addition with the running total', () => {
		expect(formatCrawlConsoleResult({ excludes: ['/admin/**'] }, baseSnapshot)).toBe(
			'exclude added: /admin/** (2 total)',
		);
	});

	it('formats multiple exclude entries added in one command', () => {
		expect(
			formatCrawlConsoleResult({ excludes: ['/a/**', '/admin/**'] }, baseSnapshot),
		).toBe('exclude added: /a/**, /admin/** (2 total)');
	});

	it('formats an exclude-url addition', () => {
		expect(
			formatCrawlConsoleResult(
				{ excludeUrls: ['https://example.com/admin/'] },
				{ ...baseSnapshot, excludeUrls: ['https://example.com/admin/'] },
			),
		).toBe('exclude-url added: https://example.com/admin/ (1 total)');
	});

	it('formats an exclude-keyword addition', () => {
		expect(
			formatCrawlConsoleResult(
				{ excludeKeywords: ['out of stock'] },
				{ ...baseSnapshot, excludeKeywords: ['out of stock'] },
			),
		).toBe('exclude-keyword added: out of stock (1 total)');
	});

	it('joins clauses for a patch touching multiple fields', () => {
		expect(
			formatCrawlConsoleResult(
				{ parallels: 2, interval: 100 },
				{ ...baseSnapshot, parallels: 2, interval: 100 },
			),
		).toBe('parallels: 2 / interval: 100ms');
	});

	it('returns an empty string for a patch touching no fields', () => {
		expect(formatCrawlConsoleResult({}, baseSnapshot)).toBe('');
	});
});
