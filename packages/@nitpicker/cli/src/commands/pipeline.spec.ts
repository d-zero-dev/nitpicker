import type { CrawlerError } from '@nitpicker/crawler';

import {
	assertChromeIsInstalled,
	assertPuppeteerSharedWithBeholder,
} from '@nitpicker/crawler';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { ExitCode } from '../exit-code.js';

import { analyze as analyzeFn } from './analyze.js';
import { CrawlAggregateError } from './crawl-aggregate-error.js';
import { startCrawl as startCrawlFn } from './crawl.js';
import { pipeline } from './pipeline.js';
import { report as reportFn } from './report.js';

vi.mock('./crawl.js', () => {
	return {
		startCrawl: vi.fn(),
	};
});

vi.mock('@nitpicker/crawler', () => ({
	assertChromeIsInstalled: vi.fn(),
	assertPuppeteerSharedWithBeholder: vi.fn(),
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
		strict: undefined,
		all: undefined,
		plugin: undefined,
		searchKeywords: undefined,
		searchScope: undefined,
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
			'Usage: npx @nitpicker/cli pipeline <URL> [options]',
		);
		expect(exitSpy).toHaveBeenCalledWith(ExitCode.Fatal);
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
				// pipeline can never trigger append mode — it always passes an
				// empty array so the dispatcher's `hasAppendFlag` stays false.
				append: [],
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

	it('dedupeCap フラグは commandDef 側も default: 10 で crawl.ts と揃えている（手書き複製ゆえの同期漏れガード）', async () => {
		const { commandDef } = await import('./pipeline.js');
		expect(commandDef.flags.dedupeCap.default).toBe(10);
	});

	it("forwards --dedupe-cap/--dedupe-map-cap to startCrawl (pipeline.ts hand-writes its own flags object rather than reusing crawl.ts's mapper, see the TODO on commandDef.flags)", async () => {
		vi.mocked(startCrawlFn).mockResolvedValue('/tmp/site.nitpicker');
		vi.mocked(analyzeFn).mockResolvedValue();

		await pipeline(['https://example.com'], {
			...defaultFlags,
			dedupeCap: 5,
			dedupeMapCap: 2000,
		});

		expect(startCrawlFn).toHaveBeenCalledWith(
			['https://example.com'],
			expect.objectContaining({
				dedupeCap: 5,
				dedupeMapCap: 2000,
			}),
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
			axeLang: 'ja',
		});

		expect(analyzeFn).toHaveBeenCalledWith(
			expect.any(Array),
			expect.objectContaining({
				plugin: ['@nitpicker/analyze-axe'],
				searchKeywords: ['test'],
				searchScope: '.main',
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

	it('passes --single flag to startCrawl', async () => {
		vi.mocked(startCrawlFn).mockResolvedValue('/tmp/site.nitpicker');
		vi.mocked(analyzeFn).mockResolvedValue();

		await pipeline(['https://example.com'], {
			...defaultFlags,
			single: true,
		});

		expect(startCrawlFn).toHaveBeenCalledWith(
			['https://example.com'],
			expect.objectContaining({ single: true }),
		);
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

	it('suppresses pipeline log output when --silent is set', async () => {
		vi.mocked(startCrawlFn).mockResolvedValue('/tmp/site.nitpicker');
		vi.mocked(analyzeFn).mockResolvedValue();

		await pipeline(['https://example.com'], {
			...defaultFlags,
			silent: true,
			all: true,
		});

		expect(consoleLogSpy).not.toHaveBeenCalled();
	});

	it('suppresses pipeline log output when --silent is set with --sheet', async () => {
		vi.mocked(startCrawlFn).mockResolvedValue('/tmp/site.nitpicker');
		vi.mocked(analyzeFn).mockResolvedValue();
		vi.mocked(reportFn).mockResolvedValue();

		await pipeline(['https://example.com'], {
			...defaultFlags,
			silent: true,
			sheet: 'https://docs.google.com/spreadsheets/d/xxx',
		});

		expect(consoleLogSpy).not.toHaveBeenCalled();
	});

	it('shows completion message after all steps', async () => {
		vi.mocked(startCrawlFn).mockResolvedValue('/tmp/site.nitpicker');
		vi.mocked(analyzeFn).mockResolvedValue();

		await pipeline(['https://example.com'], defaultFlags);

		expect(consoleLogSpy).toHaveBeenCalledWith('\n✅ [pipeline] All steps completed.');
	});

	it('exits with warning (code 2) when crawl has only external errors', async () => {
		const externalError: CrawlerError = {
			pid: 1,
			isMainProcess: true,
			url: 'https://external.example.com',
			isExternal: true,
			error: new Error('DNS lookup failed'),
		};
		vi.mocked(startCrawlFn).mockRejectedValue(new CrawlAggregateError([externalError]));

		await expect(pipeline(['https://example.com'], defaultFlags)).rejects.toThrow(
			ExitError,
		);
		expect(exitSpy).toHaveBeenCalledWith(ExitCode.Warning);
	});

	it('propagates CrawlAggregateError with internal errors', async () => {
		const internalError: CrawlerError = {
			pid: 1,
			isMainProcess: true,
			url: 'https://example.com/page',
			isExternal: false,
			error: new Error('Internal failure'),
		};
		vi.mocked(startCrawlFn).mockRejectedValue(new CrawlAggregateError([internalError]));

		await expect(pipeline(['https://example.com'], defaultFlags)).rejects.toThrow(
			CrawlAggregateError,
		);
	});

	it('exits with fatal (code 1) when --strict and external-only errors', async () => {
		const externalError: CrawlerError = {
			pid: 1,
			isMainProcess: true,
			url: 'https://external.example.com',
			isExternal: true,
			error: new Error('DNS lookup failed'),
		};
		vi.mocked(startCrawlFn).mockRejectedValue(new CrawlAggregateError([externalError]));

		await expect(
			pipeline(['https://example.com'], { ...defaultFlags, strict: true }),
		).rejects.toThrow(CrawlAggregateError);
	});

	it('passes --strict flag to startCrawl', async () => {
		vi.mocked(startCrawlFn).mockResolvedValue('/tmp/site.nitpicker');
		vi.mocked(analyzeFn).mockResolvedValue();

		await pipeline(['https://example.com'], {
			...defaultFlags,
			strict: true,
		});

		expect(startCrawlFn).toHaveBeenCalledWith(
			['https://example.com'],
			expect.objectContaining({ strict: true }),
		);
	});

	it('crawl 開始前に assertChromeIsInstalled を呼び出す', async () => {
		vi.mocked(startCrawlFn).mockResolvedValue('/tmp/site.nitpicker');
		vi.mocked(analyzeFn).mockResolvedValue();

		await pipeline(['https://example.com'], defaultFlags);

		expect(assertChromeIsInstalled).toHaveBeenCalled();
		expect(vi.mocked(assertChromeIsInstalled).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(startCrawlFn).mock.invocationCallOrder[0]!,
		);
	});

	it('assertChromeIsInstalled が失敗した場合、crawl を開始せずエラーを伝播する', async () => {
		vi.mocked(assertChromeIsInstalled).mockRejectedValueOnce(
			new Error('Chrome executable not found at: /fake/chrome'),
		);

		await expect(pipeline(['https://example.com'], defaultFlags)).rejects.toThrow(
			'Chrome executable not found at: /fake/chrome',
		);
		expect(startCrawlFn).not.toHaveBeenCalled();
		expect(analyzeFn).not.toHaveBeenCalled();
	});

	it('crawl 開始前に assertPuppeteerSharedWithBeholder を呼び出す', async () => {
		vi.mocked(startCrawlFn).mockResolvedValue('/tmp/site.nitpicker');
		vi.mocked(analyzeFn).mockResolvedValue();

		await pipeline(['https://example.com'], defaultFlags);

		expect(assertPuppeteerSharedWithBeholder).toHaveBeenCalled();
		expect(
			vi.mocked(assertPuppeteerSharedWithBeholder).mock.invocationCallOrder[0],
		).toBeLessThan(vi.mocked(startCrawlFn).mock.invocationCallOrder[0]!);
	});

	it('assertPuppeteerSharedWithBeholder が失敗した場合、crawl を開始せずエラーを伝播する', async () => {
		vi.mocked(assertPuppeteerSharedWithBeholder).mockImplementationOnce(() => {
			throw new Error("crawler's puppeteer and @d-zero/beholder's puppeteer differ");
		});

		await expect(pipeline(['https://example.com'], defaultFlags)).rejects.toThrow(
			"crawler's puppeteer and @d-zero/beholder's puppeteer differ",
		);
		expect(startCrawlFn).not.toHaveBeenCalled();
		expect(analyzeFn).not.toHaveBeenCalled();
	});
});
