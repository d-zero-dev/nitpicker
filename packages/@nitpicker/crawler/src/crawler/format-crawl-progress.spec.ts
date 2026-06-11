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

	it('internal だけの crawl で done(pages) / found URLs / remaining を表示する', () => {
		const result = formatCrawlProgress({
			done: 50,
			total: 100,
			resumeOffset: 0,
			externalTotal: 0,
			externalDone: 0,
			pagesScraped: 35,
			limit: 10,
		});
		expect(result).toContain('50(35) done / 100 found URLs');
		expect(result).toContain('50 remaining');
	});

	it('external URL の進捗を `+done/total ext` として併記する', () => {
		const result = formatCrawlProgress({
			done: 60,
			total: 120,
			resumeOffset: 0,
			externalTotal: 20,
			externalDone: 10,
			pagesScraped: 40,
			limit: 5,
		});
		expect(result).toContain('50(40) done / 100 found URLs');
		expect(result).toContain('+10/20 ext');
		expect(result).toContain('60 remaining');
	});

	it('resumeOffset を done と total の両方に加算して通算値で表示する', () => {
		const result = formatCrawlProgress({
			done: 30,
			total: 50,
			resumeOffset: 100,
			externalTotal: 0,
			externalDone: 0,
			pagesScraped: 25,
			limit: 10,
		});
		expect(result).toContain('130(25) done / 150 found URLs');
		expect(result).toContain('20 remaining');
	});

	it('並列ワーカー数を `[N parallel]` で末尾に表示する', () => {
		const result = formatCrawlProgress({
			done: 10,
			total: 20,
			resumeOffset: 0,
			externalTotal: 0,
			externalDone: 0,
			pagesScraped: 8,
			limit: 8,
		});
		expect(result).toContain('8 parallel');
	});

	it('クロール開始直後（total=0）でも 0(0) done / 0 found URLs として表示できる', () => {
		const result = formatCrawlProgress({
			done: 0,
			total: 0,
			resumeOffset: 0,
			externalTotal: 0,
			externalDone: 0,
			pagesScraped: 0,
			limit: 10,
		});
		expect(result).toContain('0(0) done / 0 found URLs');
		expect(result).toContain('0 remaining');
	});

	it('remaining = internal残り + external残り として合算する', () => {
		const result = formatCrawlProgress({
			done: 80,
			total: 200,
			resumeOffset: 0,
			externalTotal: 50,
			externalDone: 30,
			pagesScraped: 45,
			limit: 10,
		});
		// internal remaining: (200-50) - (80-30) = 150 - 50 = 100
		// external remaining: 50 - 30 = 20
		// total remaining: 120
		expect(result).toContain('120 remaining');
	});

	it('allDone / allTotal の比率をパーセントで表示する', () => {
		const result = formatCrawlProgress({
			done: 50,
			total: 100,
			resumeOffset: 0,
			externalTotal: 0,
			externalDone: 0,
			pagesScraped: 50,
			limit: 10,
		});
		expect(result).toContain('(50%)');
	});

	it('total=0 のときパーセント計算でゼロ除算せず 0% を表示する', () => {
		const result = formatCrawlProgress({
			done: 0,
			total: 0,
			resumeOffset: 0,
			externalTotal: 0,
			externalDone: 0,
			pagesScraped: 0,
			limit: 10,
		});
		expect(result).toContain('(0%)');
	});

	it('完成形のフォーマット文字列を 1 文字ズレなく組み立てる', () => {
		const result = formatCrawlProgress({
			done: 50,
			total: 100,
			resumeOffset: 0,
			externalTotal: 0,
			externalDone: 0,
			pagesScraped: 35,
			limit: 10,
		});
		expect(result).toBe(
			'Crawling: 50(35) done / 100 found URLs (+0/0 ext) (50%) [50 remaining] [10 parallel]',
		);
	});

	it('resumeOffset と external URL が同時にある場合の計算が破綻しない', () => {
		const result = formatCrawlProgress({
			done: 40,
			total: 80,
			resumeOffset: 20,
			externalTotal: 10,
			externalDone: 5,
			pagesScraped: 30,
			limit: 5,
		});
		// allDone=60, allTotal=100, internalDone=55, internalTotal=90
		// internalRemaining=35, externalRemaining=5, totalRemaining=40
		expect(result).toContain('55(30) done / 90 found URLs');
		expect(result).toContain('+5/10 ext');
		expect(result).toContain('40 remaining');
	});

	it('100万件規模のカウントを `1,234,567` のような千区切り表記で表示する', () => {
		const result = formatCrawlProgress({
			done: 12_345,
			total: 1_234_567,
			resumeOffset: 0,
			externalTotal: 2345,
			externalDone: 1234,
			pagesScraped: 9876,
			limit: 10,
		});
		// internalDone=12345-1234=11111, internalTotal=1234567-2345=1232222
		// totalRemaining=1234567-12345=1222222
		expect(result).toContain('11,111(9,876) done / 1,232,222 found URLs');
		expect(result).toContain('+1,234/2,345 ext');
		expect(result).toContain('1,222,222 remaining');
	});

	it('CSS / image など非HTMLリソースだけが処理されている時 pagesScraped は internalDone より少なくなる', () => {
		const result = formatCrawlProgress({
			done: 100,
			total: 100,
			resumeOffset: 0,
			externalTotal: 0,
			externalDone: 0,
			pagesScraped: 12,
			limit: 10,
		});
		// 100 URLs processed but only 12 were rendered as HTML pages
		expect(result).toContain('100(12) done / 100 found URLs');
	});
});
