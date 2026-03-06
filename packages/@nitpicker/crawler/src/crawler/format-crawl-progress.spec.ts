import c from 'ansi-colors';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { formatCrawlProgress } from './format-crawl-progress.js';

describe('formatCrawlProgress', () => {
	const originalEnabled = c.enabled;

	beforeAll(() => {
		c.enabled = false;
	});

	afterAll(() => {
		c.enabled = originalEnabled;
	});

	it('shows done, found, remaining for internal pages', () => {
		const result = formatCrawlProgress({
			done: 50,
			total: 100,
			resumeOffset: 0,
			externalTotal: 0,
			externalDone: 0,
			limit: 10,
		});
		expect(result).toContain('50 done / 100 found');
		expect(result).toContain('50 remaining');
	});

	it('includes external page counts', () => {
		const result = formatCrawlProgress({
			done: 60,
			total: 120,
			resumeOffset: 0,
			externalTotal: 20,
			externalDone: 10,
			limit: 5,
		});
		expect(result).toContain('50 done / 100 found');
		expect(result).toContain('+10/20 ext');
		expect(result).toContain('60 remaining');
	});

	it('includes resumeOffset in done and total counts', () => {
		const result = formatCrawlProgress({
			done: 30,
			total: 50,
			resumeOffset: 100,
			externalTotal: 0,
			externalDone: 0,
			limit: 10,
		});
		expect(result).toContain('130 done / 150 found');
		expect(result).toContain('20 remaining');
	});

	it('shows parallel count', () => {
		const result = formatCrawlProgress({
			done: 10,
			total: 20,
			resumeOffset: 0,
			externalTotal: 0,
			externalDone: 0,
			limit: 8,
		});
		expect(result).toContain('8 parallel');
	});

	it('handles zero total', () => {
		const result = formatCrawlProgress({
			done: 0,
			total: 0,
			resumeOffset: 0,
			externalTotal: 0,
			externalDone: 0,
			limit: 10,
		});
		expect(result).toContain('0 done / 0 found');
		expect(result).toContain('0 remaining');
	});

	it('calculates remaining correctly with both internal and external', () => {
		const result = formatCrawlProgress({
			done: 80,
			total: 200,
			resumeOffset: 0,
			externalTotal: 50,
			externalDone: 30,
			limit: 10,
		});
		// internal remaining: (200-50) - (80-30) = 150 - 50 = 100
		// external remaining: 50 - 30 = 20
		// total remaining: 120
		expect(result).toContain('120 remaining');
	});

	it('produces exact expected format', () => {
		const result = formatCrawlProgress({
			done: 50,
			total: 100,
			resumeOffset: 0,
			externalTotal: 0,
			externalDone: 0,
			limit: 10,
		});
		expect(result).toBe(
			'Crawling: 50 done / 100 found (+0/0 ext) [50 remaining] [10 parallel]',
		);
	});

	it('combines resumeOffset with external URLs correctly', () => {
		const result = formatCrawlProgress({
			done: 40,
			total: 80,
			resumeOffset: 20,
			externalTotal: 10,
			externalDone: 5,
			limit: 5,
		});
		// allDone=60, allTotal=100, internalDone=55, internalTotal=90
		// internalRemaining=35, externalRemaining=5, totalRemaining=40
		expect(result).toContain('55 done / 90 found');
		expect(result).toContain('+5/10 ext');
		expect(result).toContain('40 remaining');
	});
});
