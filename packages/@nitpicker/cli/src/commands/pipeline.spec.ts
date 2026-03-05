import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { analyze as analyzeFn } from './analyze.js';
import { startCrawl as startCrawlFn } from './crawl.js';
import { pipeline } from './pipeline.js';
import { report as reportFn } from './report.js';

vi.mock('./crawl.js', () => ({
	startCrawl: vi.fn(),
}));

vi.mock('./analyze.js', () => ({
	analyze: vi.fn(),
}));

vi.mock('./report.js', () => ({
	report: vi.fn(),
}));

/** Sentinel error thrown by the process.exit mock to halt execution. */
class ExitError extends Error {
	/** The exit code passed to process.exit(). */
	readonly code: number;
	constructor(code: number) {
		super(`process.exit(${code})`);
		this.code = code;
	}
}

describe('pipeline command', () => {
	let exitSpy: ReturnType<typeof vi.spyOn>;
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
	let consoleLogSpy: ReturnType<typeof vi.spyOn>;

	/** Default flags with all values set to their defaults or undefined. */
	const defaultFlags = {
		interval: undefined,
		image: true,
		fetchExternal: true,
		parallels: undefined,
		recursive: true,
		scope: undefined,
		exclude: undefined,
		excludeKeyword: undefined,
		excludeUrl: undefined,
		disableQueries: undefined,
		imageFileSizeThreshold: undefined,
		single: undefined,
		maxExcludedDepth: undefined,
		retry: 3,
		list: undefined,
		listFile: undefined,
		userAgent: undefined,
		ignoreRobots: undefined,
		output: undefined,
		all: undefined,
		plugin: undefined,
		searchKeywords: undefined,
		searchScope: undefined,
		mainContentSelector: undefined,
		axeLang: undefined,
		sheet: undefined,
		credentials: './credentials.json',
		config: undefined,
		limit: 100_000,
		verbose: undefined,
		silent: undefined,
	} as const;

	beforeEach(() => {
		vi.clearAllMocks();
		exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new ExitError(code as number);
		});
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('exits with error when no URL is provided', async () => {
		await expect(pipeline([], defaultFlags)).rejects.toThrow(ExitError);

		expect(consoleErrorSpy).toHaveBeenCalledWith('Error: No URL specified.');
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			'Usage: nitpicker pipeline <URL> [options]',
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('runs crawl then analyze without report when --sheet is not provided', async () => {
		vi.mocked(startCrawlFn).mockResolvedValue('/tmp/site.nitpicker');
		vi.mocked(analyzeFn).mockResolvedValue();

		await pipeline(['https://example.com'], defaultFlags);

		expect(startCrawlFn).toHaveBeenCalledWith(
			['https://example.com'],
			expect.objectContaining({
				image: true,
				recursive: true,
				retry: 3,
				resume: undefined,
				diff: undefined,
			}),
		);
		expect(analyzeFn).toHaveBeenCalledWith(
			['/tmp/site.nitpicker'],
			expect.objectContaining({
				all: undefined,
				plugin: undefined,
				verbose: undefined,
			}),
		);
		expect(reportFn).not.toHaveBeenCalled();
		expect(consoleLogSpy).toHaveBeenCalledWith(
			'\n📊 [pipeline] Step 3/3: Skipped (no --sheet specified)',
		);
	});

	it('runs crawl, analyze, and report when --sheet is provided', async () => {
		const sheetUrl = 'https://docs.google.com/spreadsheets/d/xxx';
		vi.mocked(startCrawlFn).mockResolvedValue('/tmp/site.nitpicker');
		vi.mocked(analyzeFn).mockResolvedValue();
		vi.mocked(reportFn).mockResolvedValue();

		await pipeline(['https://example.com'], {
			...defaultFlags,
			sheet: sheetUrl,
			all: true,
		});

		expect(startCrawlFn).toHaveBeenCalledWith(
			['https://example.com'],
			expect.objectContaining({ image: true }),
		);
		expect(analyzeFn).toHaveBeenCalledWith(
			['/tmp/site.nitpicker'],
			expect.objectContaining({ all: true }),
		);
		expect(reportFn).toHaveBeenCalledWith(
			['/tmp/site.nitpicker'],
			expect.objectContaining({
				sheet: sheetUrl,
				credentials: './credentials.json',
				limit: 100_000,
				all: true,
			}),
		);
	});

	it('passes verbose and silent flags to all steps', async () => {
		vi.mocked(startCrawlFn).mockResolvedValue('/tmp/site.nitpicker');
		vi.mocked(analyzeFn).mockResolvedValue();

		await pipeline(['https://example.com'], {
			...defaultFlags,
			verbose: true,
			silent: undefined,
		});

		expect(startCrawlFn).toHaveBeenCalledWith(
			expect.any(Array),
			expect.objectContaining({ verbose: true, silent: undefined }),
		);
		expect(analyzeFn).toHaveBeenCalledWith(
			expect.any(Array),
			expect.objectContaining({ verbose: true, silent: undefined }),
		);
	});

	it('passes silent flag to analyze and report', async () => {
		vi.mocked(startCrawlFn).mockResolvedValue('/tmp/site.nitpicker');
		vi.mocked(analyzeFn).mockResolvedValue();
		vi.mocked(reportFn).mockResolvedValue();

		await pipeline(['https://example.com'], {
			...defaultFlags,
			silent: true,
			sheet: 'https://docs.google.com/spreadsheets/d/xxx',
		});

		expect(startCrawlFn).toHaveBeenCalledWith(
			expect.any(Array),
			expect.objectContaining({ silent: true }),
		);
		expect(analyzeFn).toHaveBeenCalledWith(
			expect.any(Array),
			expect.objectContaining({ silent: true }),
		);
		expect(reportFn).toHaveBeenCalledWith(
			expect.any(Array),
			expect.objectContaining({ silent: true }),
		);
	});

	it('passes analyze-specific flags correctly', async () => {
		vi.mocked(startCrawlFn).mockResolvedValue('/tmp/site.nitpicker');
		vi.mocked(analyzeFn).mockResolvedValue();

		await pipeline(['https://example.com'], {
			...defaultFlags,
			plugin: ['@nitpicker/analyze-axe'],
			searchKeywords: ['test'],
			searchScope: '.main',
			mainContentSelector: '#content',
			axeLang: 'ja',
		});

		expect(analyzeFn).toHaveBeenCalledWith(
			expect.any(Array),
			expect.objectContaining({
				plugin: ['@nitpicker/analyze-axe'],
				searchKeywords: ['test'],
				searchScope: '.main',
				mainContentSelector: '#content',
				axeLang: 'ja',
			}),
		);
	});

	it('passes crawl output path to analyze and report', async () => {
		const archivePath = '/custom/output/site.nitpicker';
		vi.mocked(startCrawlFn).mockResolvedValue(archivePath);
		vi.mocked(analyzeFn).mockResolvedValue();
		vi.mocked(reportFn).mockResolvedValue();

		await pipeline(['https://example.com'], {
			...defaultFlags,
			output: '/custom/output/site',
			sheet: 'https://docs.google.com/spreadsheets/d/xxx',
		});

		expect(analyzeFn).toHaveBeenCalledWith([archivePath], expect.any(Object));
		expect(reportFn).toHaveBeenCalledWith([archivePath], expect.any(Object));
	});

	it('propagates error when startCrawl rejects', async () => {
		const crawlError = new Error('Crawl failed');
		vi.mocked(startCrawlFn).mockRejectedValue(crawlError);

		await expect(pipeline(['https://example.com'], defaultFlags)).rejects.toThrow(
			'Crawl failed',
		);

		expect(analyzeFn).not.toHaveBeenCalled();
		expect(reportFn).not.toHaveBeenCalled();
	});

	it('propagates error when analyze rejects', async () => {
		vi.mocked(startCrawlFn).mockResolvedValue('/tmp/site.nitpicker');
		vi.mocked(analyzeFn).mockRejectedValue(new Error('Analyze failed'));

		await expect(pipeline(['https://example.com'], defaultFlags)).rejects.toThrow(
			'Analyze failed',
		);

		expect(reportFn).not.toHaveBeenCalled();
	});

	it('propagates error when report rejects', async () => {
		vi.mocked(startCrawlFn).mockResolvedValue('/tmp/site.nitpicker');
		vi.mocked(analyzeFn).mockResolvedValue();
		vi.mocked(reportFn).mockRejectedValue(new Error('Report failed'));

		await expect(
			pipeline(['https://example.com'], {
				...defaultFlags,
				sheet: 'https://docs.google.com/spreadsheets/d/xxx',
			}),
		).rejects.toThrow('Report failed');
	});

	it('shows completion message after all steps', async () => {
		vi.mocked(startCrawlFn).mockResolvedValue('/tmp/site.nitpicker');
		vi.mocked(analyzeFn).mockResolvedValue();

		await pipeline(['https://example.com'], defaultFlags);

		expect(consoleLogSpy).toHaveBeenCalledWith('\n✅ [pipeline] All steps completed.');
	});
});
