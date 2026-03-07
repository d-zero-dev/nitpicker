import type {
	CrawlerOrchestrator as OrchestratorType,
	CrawlerError,
} from '@nitpicker/crawler';

import path from 'node:path';

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { ExitCode } from '../exit-code.js';

const mockCrawling = vi.fn();
const mockResume = vi.fn();

vi.mock('@nitpicker/crawler', () => ({
	CrawlerOrchestrator: {
		crawling: mockCrawling,
		resume: mockResume,
	},
}));

const mockEventAssignments = vi.fn().mockResolvedValue();

vi.mock('../crawl/event-assignments.js', () => ({
	eventAssignments: mockEventAssignments,
}));

const mockVerbosely = vi.fn();
const mockLog = vi.fn();

vi.mock('../crawl/debug.js', () => ({
	log: mockLog,
	verbosely: mockVerbosely,
}));

const mockDiff = vi.fn().mockResolvedValue();

vi.mock('../crawl/diff.js', () => ({
	diff: mockDiff,
}));

const mockReadList = vi.fn().mockResolvedValue(['https://example.com/from-file']);

vi.mock('@d-zero/readtext/list', () => ({
	readList: mockReadList,
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type CrawlFlags = Parameters<typeof import('./crawl.js').startCrawl>[1];

/**
 * Minimal flags matching the shape produced by the CLI parser.
 * @param overrides - Flag values to override defaults.
 */
function createFlags(overrides: Partial<CrawlFlags> = {}): CrawlFlags {
	return {
		resume: undefined,
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
		strict: undefined,
		verbose: undefined,
		silent: undefined,
		diff: undefined,
		...overrides,
	} as CrawlFlags;
}

/** Sets up the fake orchestrator that mockCrawling returns. */
function setupFakeOrchestrator() {
	const fakeOrchestrator = {
		write: vi.fn().mockResolvedValue(),
		garbageCollect: vi.fn(),
		archive: { filePath: '/tmp/test.nitpicker' },
	} as unknown as OrchestratorType;

	mockCrawling.mockImplementation((_urls, _opts, cb) => {
		cb?.(fakeOrchestrator, { baseUrl: 'https://example.com' });
		return Promise.resolve(fakeOrchestrator);
	});

	mockResume.mockImplementation((_path, _opts, cb) => {
		cb?.(fakeOrchestrator, { baseUrl: 'https://example.com' });
		return Promise.resolve(fakeOrchestrator);
	});

	return fakeOrchestrator;
}

describe('startCrawl', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupFakeOrchestrator();
	});

	it('--single フラグが true の場合、recursive: false で CrawlerOrchestrator.crawling を呼び出す', async () => {
		const { startCrawl } = await import('./crawl.js');
		await startCrawl(['https://example.com'], createFlags({ single: true }));

		expect(mockCrawling).toHaveBeenCalledWith(
			['https://example.com'],
			expect.objectContaining({ recursive: false }),
			expect.any(Function),
		);
	});

	it('--single フラグが未指定の場合、recursive はフラグの値がそのまま渡される', async () => {
		const { startCrawl } = await import('./crawl.js');
		await startCrawl(['https://example.com'], createFlags({ recursive: true }));

		expect(mockCrawling).toHaveBeenCalledWith(
			['https://example.com'],
			expect.objectContaining({ recursive: true }),
			expect.any(Function),
		);
	});

	it('--single と --recursive が同時指定された場合、--single が優先され recursive: false になる', async () => {
		const { startCrawl } = await import('./crawl.js');
		await startCrawl(
			['https://example.com'],
			createFlags({ single: true, recursive: true }),
		);

		expect(mockCrawling).toHaveBeenCalledWith(
			['https://example.com'],
			expect.objectContaining({ recursive: false }),
			expect.any(Function),
		);
	});

	it('--list モードでも recursive: false になる', async () => {
		const { startCrawl } = await import('./crawl.js');
		await startCrawl(
			['https://example.com'],
			createFlags({ list: ['https://example.com/a'] }),
		);

		expect(mockCrawling).toHaveBeenCalledWith(
			['https://example.com'],
			expect.objectContaining({ recursive: false, list: true }),
			expect.any(Function),
		);
	});

	it('--output フラグを filePath として渡す', async () => {
		const { startCrawl } = await import('./crawl.js');
		await startCrawl(['https://example.com'], createFlags({ output: '/custom/output' }));

		expect(mockCrawling).toHaveBeenCalledWith(
			['https://example.com'],
			expect.objectContaining({ filePath: '/custom/output' }),
			expect.any(Function),
		);
	});

	it('アーカイブファイルパスを返す', async () => {
		const { startCrawl } = await import('./crawl.js');
		const result = await startCrawl(['https://example.com'], createFlags());

		expect(result).toBe('/tmp/test.nitpicker');
	});

	it('イベントエラー発生時に CrawlAggregateError をスローする', async () => {
		mockEventAssignments.mockRejectedValueOnce(new Error('scrape failed'));

		const { startCrawl, CrawlAggregateError } = await import('./crawl.js');

		await expect(startCrawl(['https://example.com'], createFlags())).rejects.toThrow(
			CrawlAggregateError,
		);
	});
});

describe('crawl', () => {
	let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		setupFakeOrchestrator();
		consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('--single と --list を同時指定した場合、警告を出力する', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl([], createFlags({ single: true, list: ['https://example.com/a'] }));

		expect(consoleWarnSpy).toHaveBeenCalledWith(
			'Warning: --single is ignored when --list or --list-file is specified.',
		);
	});

	it('--single と --list-file を同時指定した場合、警告を出力する', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl([], createFlags({ single: true, listFile: '/tmp/list.txt' }));

		expect(consoleWarnSpy).toHaveBeenCalledWith(
			'Warning: --single is ignored when --list or --list-file is specified.',
		);
	});

	it('--single のみの場合、警告を出力しない', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl(['https://example.com'], createFlags({ single: true }));

		expect(consoleWarnSpy).not.toHaveBeenCalled();
	});

	it('--diff モードで引数が2つの場合、diff() を呼び出す', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl(['a.nitpicker', 'b.nitpicker'], createFlags({ diff: true }));

		expect(mockDiff).toHaveBeenCalledWith('a.nitpicker', 'b.nitpicker');
		expect(mockCrawling).not.toHaveBeenCalled();
	});

	it('--diff モードで引数が不足している場合、エラーを投げる', async () => {
		const { crawl } = await import('./crawl.js');

		await expect(crawl([], createFlags({ diff: true }))).rejects.toThrow(
			'Please provide two file paths to compare',
		);
	});

	it('--diff モードで引数が1つの場合、エラーを投げる', async () => {
		const { crawl } = await import('./crawl.js');

		await expect(crawl(['a.nitpicker'], createFlags({ diff: true }))).rejects.toThrow(
			'Please provide two file paths to compare',
		);
	});

	it('--resume に絶対パスを指定した場合、そのまま渡す', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl([], createFlags({ resume: '/absolute/stub' }));

		expect(mockResume).toHaveBeenCalledWith(
			'/absolute/stub',
			expect.any(Object),
			expect.any(Function),
		);
		expect(mockCrawling).not.toHaveBeenCalled();
	});

	it('--resume に相対パスを指定した場合、resolve して渡す', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl([], createFlags({ resume: 'relative/stub' }));

		expect(mockResume).toHaveBeenCalledWith(
			path.resolve(process.cwd(), 'relative/stub'),
			expect.any(Object),
			expect.any(Function),
		);
	});

	it('--resume と --output を同時指定した場合、エラーを投げる', async () => {
		const { crawl } = await import('./crawl.js');

		await expect(
			crawl([], createFlags({ resume: '/tmp/stub', output: '/tmp/out' })),
		).rejects.toThrow(
			'--output flag is not supported with --resume. The archive path is determined by the stub file.',
		);
	});

	it('--verbose フラグで verbosely() を呼び出す', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl(['https://example.com'], createFlags({ verbose: true }));

		expect(mockVerbosely).toHaveBeenCalled();
	});

	it('--verbose が未指定の場合、verbosely() を呼び出さない', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl(['https://example.com'], createFlags());

		expect(mockVerbosely).not.toHaveBeenCalled();
	});

	it('--verbose と --silent を同時指定した場合、verbosely() を呼び出さない', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl(['https://example.com'], createFlags({ verbose: true, silent: true }));

		expect(mockVerbosely).not.toHaveBeenCalled();
	});

	it('--list-file フラグでファイルからURLリストを読み込んで startCrawl を呼び出す', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl([], createFlags({ listFile: '/tmp/urls.txt' }));

		expect(mockReadList).toHaveBeenCalledWith(
			path.resolve(process.cwd(), '/tmp/urls.txt'),
		);
		expect(mockCrawling).toHaveBeenCalledWith(
			['https://example.com/from-file'],
			expect.objectContaining({ list: true }),
			expect.any(Function),
		);
	});

	it('--list と args を両方指定した場合、マージして startCrawl を呼び出す', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl(
			['https://example.com/arg'],
			createFlags({ list: ['https://example.com/list'] }),
		);

		expect(mockCrawling).toHaveBeenCalledWith(
			['https://example.com/list', 'https://example.com/arg'],
			expect.any(Object),
			expect.any(Function),
		);
	});

	it('単一 URL 引数で startCrawl を呼び出す', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl(['https://example.com'], createFlags());

		expect(mockCrawling).toHaveBeenCalledWith(
			['https://example.com'],
			expect.any(Object),
			expect.any(Function),
		);
	});

	it('引数なし・フラグなしの場合、何も呼び出さずに正常終了する', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl([], createFlags());

		expect(mockCrawling).not.toHaveBeenCalled();
		expect(mockResume).not.toHaveBeenCalled();
		expect(mockDiff).not.toHaveBeenCalled();
	});

	it('常に log() でフラグをログ出力する', async () => {
		const { crawl } = await import('./crawl.js');
		const flags = createFlags();
		await crawl([], flags);

		expect(mockLog).toHaveBeenCalledWith('Options: %O', flags);
	});
});

/** Sentinel error thrown by the process.exit mock to halt execution. */
class ExitError extends Error {
	/** The exit code passed to process.exit(). */
	readonly code: number;
	constructor(code: number) {
		super(`process.exit(${code})`);
		this.code = code;
	}
}

/**
 * Creates a fake CrawlerError for testing.
 * @param isExternal - Whether the error is from an external URL.
 */
function createCrawlerError(isExternal: boolean): CrawlerError {
	return {
		pid: 1,
		isMainProcess: true,
		url: isExternal ? 'https://external.example.com' : 'https://example.com/page',
		isExternal,
		error: new Error('test error'),
	};
}

describe('CrawlAggregateError', () => {
	it('外部エラーのみの場合、hasOnlyExternalErrors が true', async () => {
		const { CrawlAggregateError } = await import('./crawl.js');
		const error = new CrawlAggregateError([
			createCrawlerError(true),
			createCrawlerError(true),
		]);
		expect(error.hasOnlyExternalErrors).toBe(true);
	});

	it('内部エラーを含む場合、hasOnlyExternalErrors が false', async () => {
		const { CrawlAggregateError } = await import('./crawl.js');
		const error = new CrawlAggregateError([
			createCrawlerError(true),
			createCrawlerError(false),
		]);
		expect(error.hasOnlyExternalErrors).toBe(false);
	});

	it('内部エラーのみの場合、hasOnlyExternalErrors が false', async () => {
		const { CrawlAggregateError } = await import('./crawl.js');
		const error = new CrawlAggregateError([createCrawlerError(false)]);
		expect(error.hasOnlyExternalErrors).toBe(false);
	});

	it('plain Error は内部エラーとして扱う', async () => {
		const { CrawlAggregateError } = await import('./crawl.js');
		const error = new CrawlAggregateError([new Error('plain error')]);
		expect(error.hasOnlyExternalErrors).toBe(false);
	});

	it('空の配列に対して hasOnlyExternalErrors が false', async () => {
		const { CrawlAggregateError } = await import('./crawl.js');
		const error = new CrawlAggregateError([]);
		expect(error.hasOnlyExternalErrors).toBe(false);
		expect(error.errors).toHaveLength(0);
	});

	it('外部エラーのみの場合、message に "external" の内訳を含む', async () => {
		const { CrawlAggregateError } = await import('./crawl.js');
		const error = new CrawlAggregateError([
			createCrawlerError(true),
			createCrawlerError(true),
		]);
		expect(error.message).toBe('Crawl completed with 2 error(s) (2 external).');
	});

	it('混合エラーの場合、message に内部と外部の内訳を含む', async () => {
		const { CrawlAggregateError } = await import('./crawl.js');
		const error = new CrawlAggregateError([
			createCrawlerError(false),
			createCrawlerError(true),
			createCrawlerError(false),
		]);
		expect(error.message).toBe(
			'Crawl completed with 3 error(s) (2 internal, 1 external).',
		);
	});

	it('内部エラーのみの場合、message に "internal" の内訳を含む', async () => {
		const { CrawlAggregateError } = await import('./crawl.js');
		const error = new CrawlAggregateError([createCrawlerError(false)]);
		expect(error.message).toBe('Crawl completed with 1 error(s) (1 internal).');
	});
});

describe('crawl exit codes', () => {
	let exitSpy: ReturnType<typeof vi.spyOn>;
	beforeEach(() => {
		vi.clearAllMocks();
		setupFakeOrchestrator();
		exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new ExitError(code as number);
		});
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('外部エラーのみの場合、サマリーに "external" を含む', async () => {
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		mockEventAssignments.mockRejectedValueOnce(createCrawlerError(true));

		const { crawl } = await import('./crawl.js');

		try {
			await crawl(['https://example.com'], createFlags());
		} catch {
			// exit mock throws
		}
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			'\nCompleted with 1 error(s) (1 external).',
		);
	});

	it('内部エラーの場合、サマリーに "internal" を含む', async () => {
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		mockEventAssignments.mockRejectedValueOnce(createCrawlerError(false));

		const { crawl } = await import('./crawl.js');

		try {
			await crawl(['https://example.com'], createFlags());
		} catch {
			// exit mock throws
		}
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			'\nCompleted with 1 error(s) (1 internal).',
		);
	});

	it('--resume 経由の外部エラーでも exit code 2 で終了する', async () => {
		mockEventAssignments.mockRejectedValueOnce(createCrawlerError(true));

		const { crawl } = await import('./crawl.js');

		await expect(crawl([], createFlags({ resume: '/tmp/stub' }))).rejects.toThrow(
			ExitError,
		);
		expect(exitSpy).toHaveBeenCalledWith(ExitCode.Warning);
	});

	it('外部エラーのみの場合、exit code 2 で終了する', async () => {
		mockEventAssignments.mockRejectedValueOnce(createCrawlerError(true));

		const { crawl } = await import('./crawl.js');

		await expect(crawl(['https://example.com'], createFlags())).rejects.toThrow(
			ExitError,
		);
		expect(exitSpy).toHaveBeenCalledWith(ExitCode.Warning);
	});

	it('内部エラーを含む場合、exit code 1 で終了する', async () => {
		mockEventAssignments.mockRejectedValueOnce(createCrawlerError(false));

		const { crawl } = await import('./crawl.js');

		await expect(crawl(['https://example.com'], createFlags())).rejects.toThrow(
			ExitError,
		);
		expect(exitSpy).toHaveBeenCalledWith(ExitCode.Fatal);
	});

	it('--strict 指定時、外部エラーのみでも exit code 1 で終了する', async () => {
		mockEventAssignments.mockRejectedValueOnce(createCrawlerError(true));

		const { crawl } = await import('./crawl.js');

		await expect(
			crawl(['https://example.com'], createFlags({ strict: true })),
		).rejects.toThrow(ExitError);
		expect(exitSpy).toHaveBeenCalledWith(ExitCode.Fatal);
	});
});
