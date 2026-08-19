import type { attachCrawlDisplay as AttachCrawlDisplayFn } from '../crawl/attach-crawl-display.js';
import type * as DealerModule from '@d-zero/dealer';
import type {
	CrawlerOrchestrator as OrchestratorType,
	CrawlerError,
} from '@nitpicker/crawler';

import path from 'node:path';

import { TaskListStepError } from '@d-zero/dealer';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { ExitCode } from '../exit-code.js';

const mockCrawling = vi.fn();
const mockResume = vi.fn();
const mockAppend = vi.fn();
const mockRetryFailed = vi.fn();
const mockInventory = vi.fn();
const mockComputeFileSha256 = vi.fn(() => 'd'.repeat(64));
const mockAssertChromeIsInstalled = vi.fn().mockResolvedValue();
const mockAssertPuppeteerSharedWithBeholder = vi.fn();

vi.mock('@nitpicker/crawler', () => ({
	CrawlerOrchestrator: {
		crawling: mockCrawling,
		resume: mockResume,
		append: mockAppend,
		retryFailed: mockRetryFailed,
		inventory: mockInventory,
	},
	computeFileSha256: mockComputeFileSha256,
	assertChromeIsInstalled: mockAssertChromeIsInstalled,
	assertPuppeteerSharedWithBeholder: mockAssertPuppeteerSharedWithBeholder,
	// Real content doesn't matter to this suite — `createSetupTaskList` is
	// mocked wholesale below, so these are only ever forwarded as opaque
	// values, never iterated for their actual phase labels.
	RESUME_SETUP_PHASES: ['Reconnecting to archive'],
	APPEND_SETUP_PHASES: ['Extracting archive'],
	INVENTORY_SETUP_PHASES: ['Extracting archive'],
	RETRY_FAILED_SETUP_PHASES: ['Extracting archive'],
}));

/**
 * Mocks `attachCrawlDisplay` to push `error` into the `errStack` array it's
 * called with — the current equivalent of the pre-TaskList suite's
 * `mockEventAssignments.mockRejectedValueOnce(error)`. `attachCrawlDisplay`
 * is synchronous now (no promise to reject); a crawl-time error instead
 * reaches `errStack` via the `'error'` event listener it registers, which
 * this stands in for directly.
 * @param error - The crawl-time error to simulate.
 */
function simulateCrawlTimeError(error: CrawlerError | Error) {
	mockAttachCrawlDisplay.mockImplementationOnce(({ errStack }) => {
		errStack.push(error);
		return {
			taskListDone: Promise.resolve(),
			finish: mockAttachCrawlDisplayFinish,
			fail: mockAttachCrawlDisplayFail,
		};
	});
}

const mockAttachCrawlDisplayFinish = vi.fn();
const mockAttachCrawlDisplayFail = vi.fn();
const mockAttachCrawlDisplay = vi.fn<AttachCrawlDisplayFn>(() => ({
	taskListDone: Promise.resolve(),
	finish: mockAttachCrawlDisplayFinish,
	fail: mockAttachCrawlDisplayFail,
}));

vi.mock('../crawl/attach-crawl-display.js', () => ({
	attachCrawlDisplay: (...args: Parameters<AttachCrawlDisplayFn>) =>
		mockAttachCrawlDisplay(...args),
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

/**
 * Stands in for the real post-crawl pipeline (scan JS resources → build
 * viewer read model → write archive), collapsed to just `orchestrator.write()`
 * — the one call downstream assertions in this suite (archive.close()/
 * garbageCollect() ordering, write-failure propagation) actually depend on.
 * The scan/read-model/write internal ordering and `--silent` behavior are
 * covered by `run-post-crawl-task-list.spec.ts`, not here.
 */
const mockRunPostCrawlTaskList = vi.fn(async (orchestrator: OrchestratorType) => {
	await orchestrator.write();
});

vi.mock('../crawl/run-post-crawl-task-list.js', () => ({
	runPostCrawlTaskList: (...args: Parameters<typeof mockRunPostCrawlTaskList>) =>
		mockRunPostCrawlTaskList(...args),
}));

const mockSetupTaskListFinish = vi.fn();
const mockSetupTaskListFail = vi.fn();
const mockSetupProgress = { onPhase: vi.fn() };
const mockCreateSetupTaskList = vi.fn(() => ({
	setupProgress: mockSetupProgress,
	taskListDone: Promise.resolve(),
	finish: mockSetupTaskListFinish,
	fail: mockSetupTaskListFail,
}));

vi.mock('../crawl/create-setup-task-list.js', () => ({
	createSetupTaskList: (...args: Parameters<typeof mockCreateSetupTaskList>) =>
		mockCreateSetupTaskList(...args),
}));

/** Records the task-list row name `crawl.ts`'s Chrome check builds, in call order. */
const mockTaskListPipeName = vi.fn();

vi.mock('@d-zero/dealer', async (importOriginal) => {
	const actual = await importOriginal<typeof DealerModule>();
	return {
		// Real `TaskListStepError` — `crawl.ts`'s `unwrapTaskListStepError`
		// does an `instanceof` check against it, which needs the actual class
		// (not a mock stand-in) to behave correctly.
		TaskListStepError: actual.TaskListStepError,
		TaskList: {
			pipe: (name: string, fn: () => unknown) => {
				mockTaskListPipeName(name);
				return { run: () => Promise.resolve(fn()) };
			},
		},
	};
});

const mockReadList = vi.fn().mockResolvedValue(['https://example.com/from-file']);

/**
 * Minimal reimplementation of `@d-zero/readtext`'s position-aware list
 * parser (split → trim → drop blank/`#`-comment lines, tracking 1-origin
 * line/column), standing in for the real dependency in this suite.
 * @param text - Raw list-file text to parse.
 */
function fakeToListWithPosition(text: string) {
	const lines = text.split('\n');
	const items: { value: string; line: number; column: number }[] = [];
	for (const [index, rawLine] of lines.entries()) {
		const value = rawLine.trim();
		if (value.length === 0 || value.startsWith('#')) {
			continue;
		}
		const leadingWhitespaceLength = rawLine.length - rawLine.trimStart().length;
		items.push({ value, line: index + 1, column: leadingWhitespaceLength + 1 });
	}
	return items;
}

const mockToListWithPosition = vi.fn(fakeToListWithPosition);

vi.mock('@d-zero/readtext/list', () => ({
	readList: mockReadList,
	toListWithPosition: mockToListWithPosition,
}));

const mockReadFile = vi
	.fn()
	.mockResolvedValue(Buffer.from('https://example.com/hidden\n'));

vi.mock('node:fs/promises', () => ({
	default: {
		readFile: (...args: unknown[]) => mockReadFile(...args),
	},
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
		append: undefined,
		retryFailed: undefined,
		inventory: undefined,
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
		archive: { filePath: '/tmp/test.nitpicker', close: vi.fn().mockResolvedValue() },
	} as unknown as OrchestratorType;
	Object.assign(fakeOrchestrator, {
		async [Symbol.asyncDispose]() {
			await fakeOrchestrator.archive.close();
			fakeOrchestrator.garbageCollect();
		},
	});

	mockCrawling.mockImplementation((_urls, _opts, cb) => {
		cb?.(fakeOrchestrator, { baseUrl: 'https://example.com' });
		return Promise.resolve(fakeOrchestrator);
	});

	mockResume.mockImplementation((_path, _opts, cb) => {
		cb?.(fakeOrchestrator, { baseUrl: 'https://example.com' });
		return Promise.resolve(fakeOrchestrator);
	});

	mockAppend.mockImplementation((_path, _urls, _opts, cb) => {
		cb?.(fakeOrchestrator, { baseUrl: 'https://example.com' });
		return Promise.resolve(fakeOrchestrator);
	});

	mockRetryFailed.mockImplementation((_path, _opts, cb) => {
		cb?.(fakeOrchestrator, { baseUrl: 'https://example.com' });
		return Promise.resolve(fakeOrchestrator);
	});

	mockInventory.mockImplementation((_path, _urls, _opts, cb) => {
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

	it('dedupeCap フラグは default: 10 で on-by-default （--no-dedupe-cap / --dedupeCap 0 で無効化できる前提）', async () => {
		const { commandDef } = await import('./crawl-def.js');
		expect(commandDef.flags.dedupeCap.default).toBe(10);
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

	it('完了後にシグナルリスナーが蓄積しない', async () => {
		const { startCrawl } = await import('./crawl.js');
		const before = process.listenerCount('SIGINT');

		await startCrawl(['https://example.com'], createFlags());
		await startCrawl(['https://example.com'], createFlags());
		await startCrawl(['https://example.com'], createFlags());

		expect(process.listenerCount('SIGINT')).toBe(before);
	});

	it('crawl 中にエラーが起きてもシグナルリスナーが解除される', async () => {
		simulateCrawlTimeError(new Error('scrape failed'));
		const { startCrawl } = await import('./crawl.js');
		const before = process.listenerCount('SIGINT');

		await startCrawl(['https://example.com'], createFlags()).catch(() => {});

		expect(process.listenerCount('SIGINT')).toBe(before);
	});

	it('initializedCallback 発火後に CrawlerOrchestrator.crawling 自体が失敗しても、シグナルリスナーが蓄積せず display も fail() で解放される（issue #294 code review: crawling()/#setUrlOrder() 自体の失敗はハンドラ登録後に起こり得る）', async () => {
		const before = process.listenerCount('SIGINT');
		mockCrawling.mockImplementationOnce(async (_urls, _opts, cb) => {
			await cb?.({} as OrchestratorType, { baseUrl: 'https://example.com' } as never);
			throw new Error('crawling() itself failed after initializedCallback');
		});
		const { startCrawl } = await import('./crawl.js');

		await startCrawl(['https://example.com'], createFlags()).catch(() => {});

		expect(process.listenerCount('SIGINT')).toBe(before);
		expect(mockAttachCrawlDisplayFail).toHaveBeenCalledOnce();
	});

	it('イベントエラー発生時に CrawlAggregateError をスローする', async () => {
		simulateCrawlTimeError(new Error('scrape failed'));

		const { CrawlAggregateError } = await import('./crawl-aggregate-error.js');
		const { startCrawl } = await import('./crawl.js');

		await expect(startCrawl(['https://example.com'], createFlags())).rejects.toThrow(
			CrawlAggregateError,
		);
	});

	it('完了後に archive.close() を呼ぶ', async () => {
		const fake = setupFakeOrchestrator();
		const { startCrawl } = await import('./crawl.js');
		await startCrawl(['https://example.com'], createFlags());

		expect(fake.archive.close).toHaveBeenCalledOnce();
	});

	it('write → close → garbageCollect の順で呼び出される', async () => {
		const fake = setupFakeOrchestrator();
		const { startCrawl } = await import('./crawl.js');
		await startCrawl(['https://example.com'], createFlags());

		const writeMock = fake.write as unknown as ReturnType<typeof vi.fn>;
		const closeMock = fake.archive.close as unknown as ReturnType<typeof vi.fn>;
		const gcMock = fake.garbageCollect as unknown as ReturnType<typeof vi.fn>;

		const writeOrder = writeMock.mock.invocationCallOrder[0];
		const closeOrder = closeMock.mock.invocationCallOrder[0];
		const gcOrder = gcMock.mock.invocationCallOrder[0];

		expect(writeOrder).toBeDefined();
		expect(closeOrder).toBeDefined();
		expect(gcOrder).toBeDefined();
		expect(writeOrder!).toBeLessThan(closeOrder!);
		expect(closeOrder!).toBeLessThan(gcOrder!);
	});

	it('runs the post-crawl task list against the orchestrator with the right flags', async () => {
		const fake = setupFakeOrchestrator();
		const { startCrawl } = await import('./crawl.js');
		await startCrawl(['https://example.com'], createFlags({ verbose: true }));

		expect(mockRunPostCrawlTaskList).toHaveBeenCalledWith(
			fake,
			expect.objectContaining({
				verbose: true,
				silent: false,
				skipTechnologyJsScan: false,
			}),
		);
	});

	it('runPostCrawlTaskList が TaskListStepError で reject すると、元の cause を含む CrawlAggregateError になる（dealer のラップ文言を露出しない、issue #294 code review）', async () => {
		setupFakeOrchestrator();
		const cause = new Error('disk full');
		mockRunPostCrawlTaskList.mockRejectedValueOnce(
			new TaskListStepError('Write archive', 2, cause),
		);
		const { CrawlAggregateError } = await import('./crawl-aggregate-error.js');
		const { startCrawl } = await import('./crawl.js');

		const rejection = startCrawl(['https://example.com'], createFlags());
		await expect(rejection).rejects.toBeInstanceOf(CrawlAggregateError);
		try {
			await rejection;
			expect.unreachable();
		} catch (error) {
			expect((error as InstanceType<typeof CrawlAggregateError>).errors).toEqual([cause]);
			expect((error as Error).message).not.toMatch(/Step "Write archive"/);
		}
	});

	it('runPostCrawlTaskList が非 Error 値で reject しても、CrawlAggregateError.errors に Error として積まれる', async () => {
		setupFakeOrchestrator();
		mockRunPostCrawlTaskList.mockRejectedValueOnce(
			new TaskListStepError('Write archive', 2, 'plain string cause'),
		);
		const { CrawlAggregateError } = await import('./crawl-aggregate-error.js');
		const { startCrawl } = await import('./crawl.js');

		const rejection = startCrawl(['https://example.com'], createFlags());
		await expect(rejection).rejects.toBeInstanceOf(CrawlAggregateError);
		try {
			await rejection;
			expect.unreachable();
		} catch (error) {
			const [collected] = (error as InstanceType<typeof CrawlAggregateError>).errors;
			expect(collected).toBeInstanceOf(Error);
			expect((collected as Error).message).toBe('plain string cause');
		}
	});

	it('write() が失敗しても archive.close() と garbageCollect() が呼ばれ、CrawlAggregateError として原因を保持する（issue #294 code review: post-crawl 失敗も errStack と同じ経路で報告する）', async () => {
		const fake = setupFakeOrchestrator();
		(fake.write as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error('write failed'),
		);
		const { CrawlAggregateError } = await import('./crawl-aggregate-error.js');
		const { startCrawl } = await import('./crawl.js');

		const rejection = startCrawl(['https://example.com'], createFlags());
		await expect(rejection).rejects.toBeInstanceOf(CrawlAggregateError);
		try {
			await rejection;
			expect.unreachable();
		} catch (error) {
			expect((error as InstanceType<typeof CrawlAggregateError>).errors[0]).toMatchObject(
				{
					message: 'write failed',
				},
			);
		}

		expect(fake.archive.close).toHaveBeenCalledOnce();
		expect(fake.garbageCollect).toHaveBeenCalledOnce();
	});

	it('クロール中のページエラーと post-crawl 失敗が両方あっても、両方とも CrawlAggregateError に含める（issue #294 code review: 片方が他方を握り潰さない）', async () => {
		const fake = setupFakeOrchestrator();
		simulateCrawlTimeError(new Error('scrape failed'));
		(fake.write as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error('write failed'),
		);
		const { CrawlAggregateError } = await import('./crawl-aggregate-error.js');
		const { startCrawl } = await import('./crawl.js');

		const rejection = startCrawl(['https://example.com'], createFlags());
		await expect(rejection).rejects.toBeInstanceOf(CrawlAggregateError);
		try {
			await rejection;
			expect.unreachable();
		} catch (error) {
			const messages = (error as InstanceType<typeof CrawlAggregateError>).errors.map(
				(e) => e.message,
			);
			expect(messages).toEqual(expect.arrayContaining(['scrape failed', 'write failed']));
		}
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

		expect(mockDiff).toHaveBeenCalledWith('a.nitpicker', 'b.nitpicker', {
			verbose: undefined,
			silent: undefined,
		});
		expect(mockCrawling).not.toHaveBeenCalled();
	});

	it('--diff モードで引数が不足している場合、エラーを投げる', async () => {
		const { crawl } = await import('./crawl.js');

		await expect(crawl([], createFlags({ diff: true }))).rejects.toThrow(
			'--diff takes exactly two file paths to compare',
		);
	});

	it('--diff モードで引数が1つの場合、エラーを投げる', async () => {
		const { crawl } = await import('./crawl.js');

		await expect(crawl(['a.nitpicker'], createFlags({ diff: true }))).rejects.toThrow(
			'--diff takes exactly two file paths to compare',
		);
	});

	it('--diff モードで引数が3つ以上の場合、エラーを投げる', async () => {
		const { crawl } = await import('./crawl.js');

		await expect(
			crawl(['a.nitpicker', 'b.nitpicker', 'c.nitpicker'], createFlags({ diff: true })),
		).rejects.toThrow('--diff takes exactly two file paths to compare');
	});

	it('位置引数が複数ある場合、全 URL を含む配列で startCrawl を呼び出す', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl(
			['https://example.com/a', 'https://example.com/b', 'https://example.com/c'],
			createFlags(),
		);

		expect(mockCrawling).toHaveBeenCalledOnce();
		const [urlsArg] = mockCrawling.mock.calls[0]!;
		expect(urlsArg).toEqual([
			'https://example.com/a',
			'https://example.com/b',
			'https://example.com/c',
		]);
	});

	it('位置引数が単一の場合、その URL 1 つを含む配列で startCrawl を呼び出す', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl(['https://example.com'], createFlags());

		expect(mockCrawling).toHaveBeenCalledOnce();
		const [urlsArg] = mockCrawling.mock.calls[0]!;
		expect(urlsArg).toEqual(['https://example.com']);
	});

	it('--single と位置引数複数の同時指定はエラー', async () => {
		const { crawl } = await import('./crawl.js');

		await expect(
			crawl(
				['https://example.com/a', 'https://example.com/b'],
				createFlags({ single: true }),
			),
		).rejects.toThrow('--single cannot be combined with multiple positional URLs');
	});

	it('crawl <archive> --append <URL> で CrawlerOrchestrator.append が呼ばれる', async () => {
		const fake = setupFakeOrchestrator();
		const { crawl } = await import('./crawl.js');
		await crawl(
			['/tmp/existing.nitpicker'],
			createFlags({ append: ['https://sample-b.example.com/'] }),
		);

		expect(mockAppend).toHaveBeenCalledOnce();
		const [archivePath, urls] = mockAppend.mock.calls[0]!;
		expect(archivePath).toBe('/tmp/existing.nitpicker');
		expect(urls).toEqual(['https://sample-b.example.com/']);
		expect(mockCrawling).not.toHaveBeenCalled();
		expect(mockRunPostCrawlTaskList).toHaveBeenCalledWith(
			fake,
			expect.objectContaining({ silent: false, skipTechnologyJsScan: false }),
		);
	});

	it('--append: createSetupTaskList に verbose を渡し、initializedCallback 内で display 生成より先に finish() する（issue #294）', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl(
			['/tmp/existing.nitpicker'],
			createFlags({ append: ['https://sample-b.example.com/'], verbose: true }),
		);

		expect(mockCreateSetupTaskList).toHaveBeenCalledWith(
			expect.any(Array),
			expect.objectContaining({ verbose: true }),
		);
		expect(mockSetupTaskListFinish.mock.invocationCallOrder[0]!).toBeLessThan(
			mockAttachCrawlDisplay.mock.invocationCallOrder[0],
		);
		expect(mockAppend).toHaveBeenCalledWith(
			'/tmp/existing.nitpicker',
			['https://sample-b.example.com/'],
			expect.any(Object),
			expect.any(Function),
			mockSetupProgress,
		);
	});

	it('--append: シグナルハンドラは setupTaskList.finish()/taskListDone より前に登録される（issue #294 code review #3 — Ctrl-C 無防備な窓を作らない）', async () => {
		const before = process.listenerCount('SIGINT');
		let listenerCountAtFinish = -1;
		mockSetupTaskListFinish.mockImplementationOnce(() => {
			listenerCountAtFinish = process.listenerCount('SIGINT');
		});
		const { crawl } = await import('./crawl.js');

		await crawl(
			['/tmp/existing.nitpicker'],
			createFlags({ append: ['https://sample-b.example.com/'] }),
		);

		expect(listenerCountAtFinish).toBeGreaterThan(before);
	});

	it('--append: initializedCallback 発火後に factory 自体が失敗しても、シグナルハンドラは蓄積しない（issue #294 code review: crawling()/#setUrlOrder() 自体の失敗はハンドラ登録後に起こり得る）', async () => {
		const before = process.listenerCount('SIGINT');
		mockAppend.mockImplementationOnce(async (_path, _urls, _opts, cb) => {
			await cb?.({} as OrchestratorType, { baseUrl: 'https://example.com' } as never);
			throw new Error('crawling() itself failed after initializedCallback');
		});
		const { crawl } = await import('./crawl.js');

		await crawl(
			['/tmp/existing.nitpicker'],
			createFlags({ append: ['https://sample-b.example.com/'] }),
		).catch(() => {});

		expect(process.listenerCount('SIGINT')).toBe(before);
		expect(mockAttachCrawlDisplayFail).toHaveBeenCalledOnce();
	});

	it('--append: CrawlerOrchestrator.append が initializedCallback 前に throw したら setupTaskList.fail() が呼ばれる（issue #294 code review #1）', async () => {
		mockAppend.mockImplementationOnce(() =>
			Promise.reject(new Error('append setup failed before initializedCallback')),
		);
		const { crawl } = await import('./crawl.js');

		await expect(
			crawl(
				['/tmp/existing.nitpicker'],
				createFlags({ append: ['https://sample-b.example.com/'] }),
			),
		).rejects.toThrow('append setup failed before initializedCallback');

		expect(mockSetupTaskListFail).toHaveBeenCalledOnce();
	});

	it('--append --silent: setup 用 TaskList を作らない（issue #294）', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl(
			['/tmp/existing.nitpicker'],
			createFlags({ append: ['https://sample-b.example.com/'], silent: true }),
		);

		expect(mockCreateSetupTaskList).not.toHaveBeenCalled();
		expect(mockAppend).toHaveBeenCalledWith(
			'/tmp/existing.nitpicker',
			['https://sample-b.example.com/'],
			expect.any(Object),
			expect.any(Function),
			undefined,
		);
	});

	it('--append を複数回指定すると複数 URL が渡される', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl(
			['/tmp/existing.nitpicker'],
			createFlags({ append: ['https://a.example.com/', 'https://b.example.com/'] }),
		);

		expect(mockAppend).toHaveBeenCalledOnce();
		const [, urls] = mockAppend.mock.calls[0]!;
		expect(urls).toEqual(['https://a.example.com/', 'https://b.example.com/']);
	});

	it('--append を指定したのに位置引数が無いとエラー', async () => {
		const { crawl } = await import('./crawl.js');
		await expect(
			crawl([], createFlags({ append: ['https://sample-b.example.com/'] })),
		).rejects.toThrow(
			'--append requires the archive path as the positional argument (usage: crawl <archive> --append <URL>).',
		);
	});

	it('--append を指定したのに位置引数が複数あるとエラー', async () => {
		const { crawl } = await import('./crawl.js');
		await expect(
			crawl(
				['/tmp/a.nitpicker', '/tmp/b.nitpicker'],
				createFlags({ append: ['https://sample-b.example.com/'] }),
			),
		).rejects.toThrow(
			'--append takes exactly one positional argument (the archive path). Extra positionals were given — append URLs must follow `--append`, not the archive.',
		);
	});

	it('--append と --resume の同時指定はエラー', async () => {
		const { crawl } = await import('./crawl.js');
		await expect(
			crawl(
				['/tmp/a.nitpicker'],
				createFlags({ append: ['https://sample-b.example.com/'], resume: '/tmp/stub' }),
			),
		).rejects.toThrow('--resume and --append cannot be used together');
	});

	it('--append と --diff の同時指定はエラー', async () => {
		const { crawl } = await import('./crawl.js');
		await expect(
			crawl(
				['a.nitpicker', 'b.nitpicker'],
				createFlags({ append: ['https://sample-b.example.com/'], diff: true }),
			),
		).rejects.toThrow('--diff cannot be combined with --append');
	});

	it('--append と --output の同時指定はエラー', async () => {
		const { crawl } = await import('./crawl.js');
		await expect(
			crawl(
				['/tmp/a.nitpicker'],
				createFlags({
					append: ['https://sample-b.example.com/'],
					output: '/tmp/out.nitpicker',
				}),
			),
		).rejects.toThrow('--output flag is not supported with --append');
	});

	it('--append と --list の同時指定はエラー', async () => {
		const { crawl } = await import('./crawl.js');
		await expect(
			crawl(
				['/tmp/a.nitpicker'],
				createFlags({
					append: ['https://sample-b.example.com/'],
					list: ['https://sample-b.example.com/blog/'],
				}),
			),
		).rejects.toThrow('--append cannot be combined with --list');
	});

	it('--append と --single の同時指定はエラー', async () => {
		const { crawl } = await import('./crawl.js');
		await expect(
			crawl(
				['/tmp/a.nitpicker'],
				createFlags({ append: ['https://sample-b.example.com/'], single: true }),
			),
		).rejects.toThrow('--append cannot be combined with --single');
	});

	it('crawl <archive> --retry-failed で CrawlerOrchestrator.retryFailed が呼ばれる', async () => {
		const fake = setupFakeOrchestrator();
		const { crawl } = await import('./crawl.js');
		await crawl(['/tmp/existing.nitpicker'], createFlags({ retryFailed: true }));

		expect(mockRetryFailed).toHaveBeenCalledOnce();
		const [archivePath] = mockRetryFailed.mock.calls[0]!;
		expect(archivePath).toBe('/tmp/existing.nitpicker');
		expect(mockCrawling).not.toHaveBeenCalled();
		expect(mockAppend).not.toHaveBeenCalled();
		expect(mockRunPostCrawlTaskList).toHaveBeenCalledWith(fake, expect.any(Object));
	});

	it('--retry-failed: CrawlerOrchestrator.retryFailed が initializedCallback 前に throw したら setupTaskList.fail() が呼ばれる（issue #294 code review #1）', async () => {
		mockRetryFailed.mockImplementationOnce(() =>
			Promise.reject(new Error('retry-failed setup failed before initializedCallback')),
		);
		const { crawl } = await import('./crawl.js');

		await expect(
			crawl(['/tmp/existing.nitpicker'], createFlags({ retryFailed: true })),
		).rejects.toThrow('retry-failed setup failed before initializedCallback');

		expect(mockSetupTaskListFail).toHaveBeenCalledOnce();
	});

	it('--retry-failed を指定したのに位置引数が無いとエラー', async () => {
		const { crawl } = await import('./crawl.js');
		await expect(crawl([], createFlags({ retryFailed: true }))).rejects.toThrow(
			'--retry-failed requires the archive path as the positional argument (usage: crawl <archive> --retry-failed).',
		);
	});

	it('--retry-failed を指定したのに位置引数が複数あるとエラー', async () => {
		const { crawl } = await import('./crawl.js');
		await expect(
			crawl(['/tmp/a.nitpicker', '/tmp/b.nitpicker'], createFlags({ retryFailed: true })),
		).rejects.toThrow(
			'--retry-failed takes exactly one positional argument (the archive path).',
		);
	});

	it('--retry-failed と --resume の同時指定はエラー', async () => {
		const { crawl } = await import('./crawl.js');
		await expect(
			crawl(
				['/tmp/a.nitpicker'],
				createFlags({ retryFailed: true, resume: '/tmp/stub' }),
			),
		).rejects.toThrow('--resume and --retry-failed cannot be used together');
	});

	it('--retry-failed と --append の同時指定はエラー', async () => {
		const { crawl } = await import('./crawl.js');
		await expect(
			crawl(
				['/tmp/a.nitpicker'],
				createFlags({ retryFailed: true, append: ['https://sample-b.example.com/'] }),
			),
		).rejects.toThrow('--append and --retry-failed cannot be used together');
	});

	it('--retry-failed と --diff の同時指定はエラー', async () => {
		const { crawl } = await import('./crawl.js');
		await expect(
			crawl(
				['a.nitpicker', 'b.nitpicker'],
				createFlags({ retryFailed: true, diff: true }),
			),
		).rejects.toThrow('--diff cannot be combined with --retry-failed');
	});

	it('--retry-failed と --output の同時指定はエラー', async () => {
		const { crawl } = await import('./crawl.js');
		await expect(
			crawl(
				['/tmp/a.nitpicker'],
				createFlags({ retryFailed: true, output: '/tmp/out.nitpicker' }),
			),
		).rejects.toThrow('--output flag is not supported with --retry-failed');
	});

	it('--retry-failed と --list の同時指定はエラー', async () => {
		const { crawl } = await import('./crawl.js');
		await expect(
			crawl(
				['/tmp/a.nitpicker'],
				createFlags({ retryFailed: true, list: ['https://example.com/'] }),
			),
		).rejects.toThrow('--retry-failed cannot be combined with --list');
	});

	it('--retry-failed と --single の同時指定はエラー', async () => {
		const { crawl } = await import('./crawl.js');
		await expect(
			crawl(['/tmp/a.nitpicker'], createFlags({ retryFailed: true, single: true })),
		).rejects.toThrow('--retry-failed cannot be combined with --single');
	});

	it('--append × list が空配列 ([]) なら通る', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl(
			['/tmp/a.nitpicker'],
			createFlags({ append: ['https://sample-b.example.com/'], list: [] }),
		);
		expect(mockAppend).toHaveBeenCalledOnce();
	});

	it('--resume に絶対パスを指定した場合、そのまま渡す', async () => {
		const fake = setupFakeOrchestrator();
		const { crawl } = await import('./crawl.js');
		await crawl([], createFlags({ resume: '/absolute/stub' }));

		expect(mockResume).toHaveBeenCalledWith(
			'/absolute/stub',
			expect.any(Object),
			expect.any(Function),
			mockSetupProgress,
		);
		expect(mockCrawling).not.toHaveBeenCalled();
		expect(mockRunPostCrawlTaskList).toHaveBeenCalledWith(fake, expect.any(Object));
	});

	it('--resume に相対パスを指定した場合、resolve して渡す', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl([], createFlags({ resume: 'relative/stub' }));

		expect(mockResume).toHaveBeenCalledWith(
			path.resolve(process.cwd(), 'relative/stub'),
			expect.any(Object),
			expect.any(Function),
			mockSetupProgress,
		);
	});

	it('--resume: CrawlerOrchestrator.resume が initializedCallback 前に throw したら setupTaskList.fail() が呼ばれる（issue #294 code review #1）', async () => {
		mockResume.mockImplementationOnce(() =>
			Promise.reject(new Error('resume setup failed before initializedCallback')),
		);
		const { crawl } = await import('./crawl.js');

		await expect(crawl([], createFlags({ resume: '/absolute/stub' }))).rejects.toThrow(
			'resume setup failed before initializedCallback',
		);

		expect(mockSetupTaskListFail).toHaveBeenCalledOnce();
	});

	it('--resume と --output を同時指定した場合、エラーを投げる', async () => {
		const { crawl } = await import('./crawl.js');

		await expect(
			crawl([], createFlags({ resume: '/tmp/stub', output: '/tmp/out' })),
		).rejects.toThrow(
			'--output flag is not supported with --resume. The archive path is determined by the stub file.',
		);
	});

	it('--resume 経由でも完了後に archive.close() を呼ぶ', async () => {
		const fake = setupFakeOrchestrator();
		const { crawl } = await import('./crawl.js');
		await crawl([], createFlags({ resume: '/absolute/stub' }));

		expect(fake.archive.close).toHaveBeenCalledOnce();
	});

	it('--resume 経由で write() が失敗しても archive.close() が呼ばれ、CrawlAggregateError として Fatal 終了する（issue #294 code review: post-crawl 失敗も errStack と同じ経路で報告する）', async () => {
		const fake = setupFakeOrchestrator();
		(fake.write as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error('write failed'),
		);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new ExitError(code as number);
		});
		const { crawl } = await import('./crawl.js');

		try {
			await expect(crawl([], createFlags({ resume: '/absolute/stub' }))).rejects.toThrow(
				ExitError,
			);
			expect(exitSpy).toHaveBeenCalledWith(ExitCode.Fatal);
		} finally {
			exitSpy.mockRestore();
		}

		expect(fake.archive.close).toHaveBeenCalledOnce();
		expect(fake.garbageCollect).toHaveBeenCalledOnce();
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

	it('--list-file で空リストの場合、エラーを投げる', async () => {
		mockReadList.mockResolvedValueOnce([]);
		const { crawl } = await import('./crawl.js');

		await expect(crawl([], createFlags({ listFile: '/tmp/empty.txt' }))).rejects.toThrow(
			'No URLs found in list file: /tmp/empty.txt',
		);
	});

	it('--list-file に無効な URL が含まれる場合、エラーを投げる', async () => {
		mockReadList.mockResolvedValueOnce(['https://example.com', 'not-a-url']);
		const { crawl } = await import('./crawl.js');

		await expect(crawl([], createFlags({ listFile: '/tmp/urls.txt' }))).rejects.toThrow(
			'Invalid URL: "not-a-url"',
		);
	});

	it('--list に無効な URL が含まれる場合、エラーを投げる', async () => {
		const { crawl } = await import('./crawl.js');

		await expect(
			crawl([], createFlags({ list: ['https://example.com', 'bad-url'] })),
		).rejects.toThrow('Invalid URL: "bad-url"');
	});

	it('--list と args に無効な URL が含まれる場合、エラーを投げる', async () => {
		const { crawl } = await import('./crawl.js');

		await expect(
			crawl(['invalid'], createFlags({ list: ['https://example.com'] })),
		).rejects.toThrow('Invalid URL: "invalid"');
	});

	it('無効な URL 引数の場合、エラーを投げる', async () => {
		const { crawl } = await import('./crawl.js');

		await expect(crawl(['not-a-url'], createFlags())).rejects.toThrow(
			'Invalid URL: "not-a-url"',
		);
	});

	it('スペースを含む無効な URL 引数の場合、エラーを投げる', async () => {
		const { crawl } = await import('./crawl.js');

		await expect(crawl(['foo bar'], createFlags())).rejects.toThrow(
			'Invalid URL: "foo bar"',
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

	it('--inventory フラグでアーカイブと URL リストを CrawlerOrchestrator.inventory に渡す', async () => {
		const fake = setupFakeOrchestrator();
		mockReadFile.mockResolvedValueOnce(Buffer.from('https://example.com/hidden\n'));
		const { crawl } = await import('./crawl.js');

		await crawl(['/tmp/test.nitpicker'], createFlags({ inventory: '/tmp/urls.txt' }));

		expect(mockInventory).toHaveBeenCalledWith(
			'/tmp/test.nitpicker',
			['https://example.com/hidden'],
			expect.any(Object),
			expect.any(Function),
			// 5th arg: `{ sha256, bytes, invalidLineCount }`. The orchestrator
			// never sees the file path — only the CLI's precomputed digest
			// and the exact bytes it read — the absolute path is
			// deliberately NOT forwarded (privacy: leaks user-home / OS
			// structure when archives are shared).
			{
				sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
				bytes: Buffer.from('https://example.com/hidden\n'),
				invalidLineCount: 0,
			},
			// 6th arg: setup-phase progress callbacks (issue #294), from the
			// mocked `createSetupTaskList`.
			mockSetupProgress,
		);
		// And the CLI actually hashed the bytes it read — not the path,
		// not a re-read of the file.
		expect(mockComputeFileSha256).toHaveBeenCalledWith(
			Buffer.from('https://example.com/hidden\n'),
		);
		// The file is read exactly once (no separate read-then-hash pass
		// that could desync the archived copy from its own file name).
		expect(mockReadFile).toHaveBeenCalledTimes(1);
		expect(mockRunPostCrawlTaskList).toHaveBeenCalledWith(fake, expect.any(Object));
	});

	it('--inventory: CrawlerOrchestrator.inventory が initializedCallback 前に throw したら setupTaskList.fail() が呼ばれる（issue #294 code review #1）', async () => {
		mockReadFile.mockResolvedValueOnce(Buffer.from('https://example.com/hidden\n'));
		mockInventory.mockImplementationOnce(() =>
			Promise.reject(new Error('inventory setup failed before initializedCallback')),
		);
		const { crawl } = await import('./crawl.js');

		await expect(
			crawl(['/tmp/test.nitpicker'], createFlags({ inventory: '/tmp/urls.txt' })),
		).rejects.toThrow('inventory setup failed before initializedCallback');

		expect(mockSetupTaskListFail).toHaveBeenCalledOnce();
	});

	it('--inventory で空ファイルの場合、エラーを投げる', async () => {
		mockReadFile.mockResolvedValueOnce(Buffer.from(''));
		const { crawl } = await import('./crawl.js');

		await expect(
			crawl(['/tmp/test.nitpicker'], createFlags({ inventory: '/tmp/empty.txt' })),
		).rejects.toThrow('No URLs found in inventory file: /tmp/empty.txt');
	});

	it('--inventory に無効な URL が含まれる場合、警告して除外し、有効な URL のみで続行する（issue #99）', async () => {
		mockReadFile.mockResolvedValueOnce(
			Buffer.from('https://example.com/ok\nnot-a-url\n'),
		);
		const { crawl } = await import('./crawl.js');

		await crawl(['/tmp/test.nitpicker'], createFlags({ inventory: '/tmp/urls.txt' }));

		// Only the valid URL reaches the orchestrator.
		expect(mockInventory).toHaveBeenCalledWith(
			'/tmp/test.nitpicker',
			['https://example.com/ok'],
			expect.any(Object),
			expect.any(Function),
			expect.objectContaining({ sha256: expect.any(String), invalidLineCount: 1 }),
			mockSetupProgress,
		);
		// The invalid line is warned with its line:column and the offending
		// text, and the operator-typed (not resolved) list-file string.
		expect(consoleWarnSpy).toHaveBeenCalledWith(
			'[nitpicker] inventory list: skipping invalid URL at /tmp/urls.txt:2:1 — "not-a-url"',
		);
		// A one-line summary follows: 1 of 2 lines skipped, 1 URL continues.
		expect(consoleWarnSpy).toHaveBeenCalledWith(
			'[nitpicker] inventory list: 1 of 2 lines skipped as invalid; continuing with 1 URLs',
		);
	});

	it('--inventory で全行が無効な URL の場合、エラーを投げる', async () => {
		mockReadFile.mockResolvedValueOnce(Buffer.from('not-a-url\nalso-not-a-url\n'));
		const { crawl } = await import('./crawl.js');

		await expect(
			crawl(['/tmp/test.nitpicker'], createFlags({ inventory: '/tmp/urls.txt' })),
		).rejects.toThrow(
			'All 2 line(s) in inventory file failed URL validation: /tmp/urls.txt',
		);
		// The orchestrator must never see an empty/all-invalid list.
		expect(mockInventory).not.toHaveBeenCalled();
	});

	it('--inventory と位置引数なしの場合、エラーを投げる', async () => {
		const { crawl } = await import('./crawl.js');

		await expect(crawl([], createFlags({ inventory: '/tmp/urls.txt' }))).rejects.toThrow(
			'--inventory requires the archive path as the positional argument',
		);
	});

	it('--inventory と複数位置引数の場合、エラーを投げる', async () => {
		const { crawl } = await import('./crawl.js');

		await expect(
			crawl(
				['/tmp/a.nitpicker', '/tmp/b.nitpicker'],
				createFlags({ inventory: '/tmp/urls.txt' }),
			),
		).rejects.toThrow(
			'--inventory takes exactly one positional argument (the archive path).',
		);
	});

	it('--inventory と --append の同時指定はエラー', async () => {
		const { crawl } = await import('./crawl.js');

		await expect(
			crawl(
				['/tmp/test.nitpicker'],
				createFlags({
					inventory: '/tmp/urls.txt',
					append: ['https://example.com/new'],
				}),
			),
		).rejects.toThrow('--inventory and --append cannot be used together');
	});

	it('--inventory と --retry-failed の同時指定はエラー', async () => {
		const { crawl } = await import('./crawl.js');

		await expect(
			crawl(
				['/tmp/test.nitpicker'],
				createFlags({ inventory: '/tmp/urls.txt', retryFailed: true }),
			),
		).rejects.toThrow('--inventory and --retry-failed cannot be used together');
	});

	it('--inventory と --resume の同時指定はエラー', async () => {
		const { crawl } = await import('./crawl.js');

		await expect(
			crawl(
				[],
				createFlags({ inventory: '/tmp/urls.txt', resume: '/tmp/_nitpicker-stub' }),
			),
		).rejects.toThrow('--resume and --inventory cannot be used together');
	});

	it('--inventory と --diff の同時指定はエラー', async () => {
		const { crawl } = await import('./crawl.js');

		await expect(
			crawl(
				['/tmp/a.nitpicker', '/tmp/b.nitpicker'],
				createFlags({ inventory: '/tmp/urls.txt', diff: true }),
			),
		).rejects.toThrow('--diff cannot be combined with --inventory');
	});

	it('--inventory と --output の同時指定はエラー', async () => {
		const { crawl } = await import('./crawl.js');

		await expect(
			crawl(
				['/tmp/test.nitpicker'],
				createFlags({ inventory: '/tmp/urls.txt', output: '/tmp/out.nitpicker' }),
			),
		).rejects.toThrow('--output flag is not supported with --inventory');
	});

	it('--inventory と --list-file の同時指定はエラー', async () => {
		const { crawl } = await import('./crawl.js');

		await expect(
			crawl(
				['/tmp/test.nitpicker'],
				createFlags({ inventory: '/tmp/urls.txt', listFile: '/tmp/list.txt' }),
			),
		).rejects.toThrow('--inventory cannot be combined with --list-file');
	});

	it('--inventory と --list の同時指定はエラー', async () => {
		const { crawl } = await import('./crawl.js');

		await expect(
			crawl(
				['/tmp/test.nitpicker'],
				createFlags({
					inventory: '/tmp/urls.txt',
					list: ['https://example.com'],
				}),
			),
		).rejects.toThrow('--inventory cannot be combined with --list');
	});

	it('--inventory と --single の同時指定はエラー', async () => {
		const { crawl } = await import('./crawl.js');

		await expect(
			crawl(
				['/tmp/test.nitpicker'],
				createFlags({ inventory: '/tmp/urls.txt', single: true }),
			),
		).rejects.toThrow('--inventory cannot be combined with --single');
	});

	it('クロール開始前に assertChromeIsInstalled を呼び出す', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl(['https://example.com'], createFlags());

		expect(mockAssertChromeIsInstalled).toHaveBeenCalled();
		expect(mockAssertChromeIsInstalled.mock.invocationCallOrder[0]).toBeLessThan(
			mockCrawling.mock.invocationCallOrder[0]!,
		);
	});

	it('assertChromeIsInstalled の前に "Checking browser" タスクリストを構築する（issue #294）', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl(['https://example.com'], createFlags());

		expect(mockTaskListPipeName).toHaveBeenCalledWith('Checking browser');
		expect(mockTaskListPipeName.mock.invocationCallOrder[0]!).toBeLessThan(
			mockAssertChromeIsInstalled.mock.invocationCallOrder[0]!,
		);
	});

	it('--silent のときは "Checking browser" タスクリストを構築しない（issue #294）', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl(['https://example.com'], createFlags({ silent: true }));

		expect(mockTaskListPipeName).not.toHaveBeenCalled();
		expect(mockAssertChromeIsInstalled).toHaveBeenCalled();
	});

	it('assertChromeIsInstalled が失敗した場合、クロールを開始せずエラーを伝播する', async () => {
		mockAssertChromeIsInstalled.mockRejectedValueOnce(
			new Error('Chrome executable not found at: /fake/chrome'),
		);
		const { crawl } = await import('./crawl.js');

		await expect(crawl(['https://example.com'], createFlags())).rejects.toThrow(
			'Chrome executable not found at: /fake/chrome',
		);
		expect(mockCrawling).not.toHaveBeenCalled();
	});

	it('--diff モードでは assertChromeIsInstalled を呼ばない', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl(['a.nitpicker', 'b.nitpicker'], createFlags({ diff: true }));

		expect(mockAssertChromeIsInstalled).not.toHaveBeenCalled();
	});

	it('クロール開始前に assertPuppeteerSharedWithBeholder を呼び出す', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl(['https://example.com'], createFlags());

		expect(mockAssertPuppeteerSharedWithBeholder).toHaveBeenCalled();
		expect(
			mockAssertPuppeteerSharedWithBeholder.mock.invocationCallOrder[0],
		).toBeLessThan(mockCrawling.mock.invocationCallOrder[0]!);
	});

	it('assertPuppeteerSharedWithBeholder が失敗した場合、クロールを開始せずエラーを伝播する', async () => {
		mockAssertPuppeteerSharedWithBeholder.mockImplementationOnce(() => {
			throw new Error("crawler's puppeteer and @d-zero/beholder's puppeteer differ");
		});
		const { crawl } = await import('./crawl.js');

		await expect(crawl(['https://example.com'], createFlags())).rejects.toThrow(
			"crawler's puppeteer and @d-zero/beholder's puppeteer differ",
		);
		expect(mockCrawling).not.toHaveBeenCalled();
	});

	it('--diff モードでは assertPuppeteerSharedWithBeholder を呼ばない', async () => {
		const { crawl } = await import('./crawl.js');
		await crawl(['a.nitpicker', 'b.nitpicker'], createFlags({ diff: true }));

		expect(mockAssertPuppeteerSharedWithBeholder).not.toHaveBeenCalled();
	});

	it('--resume モードでも assertChromeIsInstalled が失敗すればクロールを開始しない', async () => {
		mockAssertChromeIsInstalled.mockRejectedValueOnce(
			new Error('Chrome executable not found at: /fake/chrome'),
		);
		const { crawl } = await import('./crawl.js');

		await expect(crawl([], createFlags({ resume: '/tmp/stub' }))).rejects.toThrow(
			'Chrome executable not found at: /fake/chrome',
		);
		expect(mockResume).not.toHaveBeenCalled();
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
		const { CrawlAggregateError } = await import('./crawl-aggregate-error.js');
		const error = new CrawlAggregateError([
			createCrawlerError(true),
			createCrawlerError(true),
		]);
		expect(error.hasOnlyExternalErrors).toBe(true);
	});

	it('内部エラーを含む場合、hasOnlyExternalErrors が false', async () => {
		const { CrawlAggregateError } = await import('./crawl-aggregate-error.js');
		const error = new CrawlAggregateError([
			createCrawlerError(true),
			createCrawlerError(false),
		]);
		expect(error.hasOnlyExternalErrors).toBe(false);
	});

	it('内部エラーのみの場合、hasOnlyExternalErrors が false', async () => {
		const { CrawlAggregateError } = await import('./crawl-aggregate-error.js');
		const error = new CrawlAggregateError([createCrawlerError(false)]);
		expect(error.hasOnlyExternalErrors).toBe(false);
	});

	it('plain Error は内部エラーとして扱う', async () => {
		const { CrawlAggregateError } = await import('./crawl-aggregate-error.js');
		const error = new CrawlAggregateError([new Error('plain error')]);
		expect(error.hasOnlyExternalErrors).toBe(false);
	});

	it('空の配列に対して hasOnlyExternalErrors が false', async () => {
		const { CrawlAggregateError } = await import('./crawl-aggregate-error.js');
		const error = new CrawlAggregateError([]);
		expect(error.hasOnlyExternalErrors).toBe(false);
		expect(error.errors).toHaveLength(0);
	});

	it('外部エラーのみの場合、message に "external" の内訳を含む', async () => {
		const { CrawlAggregateError } = await import('./crawl-aggregate-error.js');
		const error = new CrawlAggregateError([
			createCrawlerError(true),
			createCrawlerError(true),
		]);
		expect(error.message).toBe('Crawl completed with 2 error(s) (2 external).');
	});

	it('混合エラーの場合、message に内部と外部の内訳を含む', async () => {
		const { CrawlAggregateError } = await import('./crawl-aggregate-error.js');
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
		const { CrawlAggregateError } = await import('./crawl-aggregate-error.js');
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
		simulateCrawlTimeError(createCrawlerError(true));

		const { crawl } = await import('./crawl.js');

		try {
			await crawl(['https://example.com'], createFlags());
		} catch {
			// exit mock throws
		}
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			'\nCrawl completed with 1 error(s) (1 external).',
		);
	});

	it('内部エラーの場合、サマリーに "internal" を含む', async () => {
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		simulateCrawlTimeError(createCrawlerError(false));

		const { crawl } = await import('./crawl.js');

		try {
			await crawl(['https://example.com'], createFlags());
		} catch {
			// exit mock throws
		}
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			'\nCrawl completed with 1 error(s) (1 internal).',
		);
	});

	it('--resume 経由の外部エラーでも exit code 2 で終了する', async () => {
		simulateCrawlTimeError(createCrawlerError(true));

		const { crawl } = await import('./crawl.js');

		await expect(crawl([], createFlags({ resume: '/tmp/stub' }))).rejects.toThrow(
			ExitError,
		);
		expect(exitSpy).toHaveBeenCalledWith(ExitCode.Warning);
	});

	it('外部エラーのみの場合、exit code 2 で終了する', async () => {
		simulateCrawlTimeError(createCrawlerError(true));

		const { crawl } = await import('./crawl.js');

		await expect(crawl(['https://example.com'], createFlags())).rejects.toThrow(
			ExitError,
		);
		expect(exitSpy).toHaveBeenCalledWith(ExitCode.Warning);
	});

	it('内部エラーを含む場合、exit code 1 で終了する', async () => {
		simulateCrawlTimeError(createCrawlerError(false));

		const { crawl } = await import('./crawl.js');

		await expect(crawl(['https://example.com'], createFlags())).rejects.toThrow(
			ExitError,
		);
		expect(exitSpy).toHaveBeenCalledWith(ExitCode.Fatal);
	});

	it('--strict 指定時、外部エラーのみでも exit code 1 で終了する', async () => {
		simulateCrawlTimeError(createCrawlerError(true));

		const { crawl } = await import('./crawl.js');

		await expect(
			crawl(['https://example.com'], createFlags({ strict: true })),
		).rejects.toThrow(ExitError);
		expect(exitSpy).toHaveBeenCalledWith(ExitCode.Fatal);
	});
});
