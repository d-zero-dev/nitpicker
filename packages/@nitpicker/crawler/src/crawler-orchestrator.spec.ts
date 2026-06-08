import type Archive from './archive/archive.js';
import type { CrawlerError } from './utils/types/types.js';

import { describe, it, expect, vi, afterEach } from 'vitest';

import { CrawlerOrchestrator } from './crawler-orchestrator.js';

vi.mock('./crawler/crawler.js', () => {
	/**
	 * A minimal Crawler stand-in: records event handlers and, on `start()`,
	 * emits a single `error` event followed by `crawlEnd`. This lets tests
	 * drive the orchestrator's event-to-archive wiring without a browser.
	 */
	class FakeCrawler {
		/** Registered event handlers keyed by event name. */
		handlers = new Map<string, (payload: never) => void>();

		/** No-op abort to satisfy the orchestrator's interface. */
		abort() {}

		/**
		 * Returns an empty undead-PID list.
		 * @returns An empty array.
		 */
		getUndeadPid() {
			return [];
		}

		/**
		 * Records an event handler.
		 * @param event - The event name.
		 * @param handler - The handler function.
		 */
		on(event: string, handler: (payload: never) => void) {
			this.handlers.set(event, handler);
		}

		/** Emits `error` and then `crawlEnd`, simulating a crawl with one error. */
		start() {
			const error: CrawlerError = {
				pid: process.pid,
				isMainProcess: true,
				url: 'https://example.com/',
				isExternal: false,
				error: new Error('scrape-failure'),
			};
			this.handlers.get('error')?.(error as never);
			this.handlers.get('crawlEnd')?.(undefined as never);
		}
	}
	return { default: FakeCrawler };
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('CrawlerOrchestrator.crawling: error イベントの書き込み失敗', () => {
	it('archive.addError が reject すると crawling() 全体が reject する（unhandledRejection にならない）', async () => {
		const fakeArchive = {
			on: vi.fn(),
			setConfig: vi.fn(() => Promise.resolve()),
			getConfig: vi.fn(() => Promise.resolve({ analyze: [] })),
			addError: vi.fn(() => Promise.reject(new Error('db-write-failure'))),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			getResourceByUrl: vi.fn(() => Promise.resolve(null)),
			filePath: '/tmp/orchestrator-adderror-test.nitpicker',
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'create').mockResolvedValueOnce(fakeArchive);

		await expect(
			CrawlerOrchestrator.crawling(
				['https://example.com/'],
				{
					cwd: '/tmp',
					filePath: '/tmp/orchestrator-adderror-test.nitpicker',
				},
				(orchestrator) => {
					// 'error' イベント自体は通知される（リスナー未登録での throw を防ぐ）
					orchestrator.on('error', () => {});
				},
			),
		).rejects.toThrow('db-write-failure');

		expect(fakeArchive.addError).toHaveBeenCalledOnce();
	});
});

describe('CrawlerOrchestrator.append', () => {
	it('throws synchronously when newUrls is empty (no file I/O attempted)', async () => {
		// This guard sits before `Archive.open`, so it should reject without
		// any side effect on the filesystem. Use a non-existent path to prove
		// the early-throw never tries to open it.
		const archiveModule = await import('./archive/archive.js');
		const openSpy = vi.spyOn(archiveModule.default, 'open');

		await expect(
			CrawlerOrchestrator.append('/does/not/exist.nitpicker', [], { cwd: '/tmp' }),
		).rejects.toThrow('append: newUrls is empty');
		expect(openSpy).not.toHaveBeenCalled();
	});

	it('releases the archive lock and throws when getConfig fails', async () => {
		// Drive Archive.open into a state where the returned `archive` has a
		// failing getConfig. The factory must call `archive.close()` to release
		// the lock instead of leaking it.
		const closeSpy = vi.fn(() => Promise.resolve());
		const fakeArchive = {
			getConfig: vi.fn(() => Promise.reject(new Error('forced-getConfig-failure'))),
			close: closeSpy,
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		await expect(
			CrawlerOrchestrator.append('/tmp/anything.nitpicker', ['https://example.com/'], {
				cwd: '/tmp',
			}),
		).rejects.toThrow('forced-getConfig-failure');
		expect(closeSpy).toHaveBeenCalledOnce();
	});

	it('rejects list-mode archives and releases the lock', async () => {
		const closeSpy = vi.fn(() => Promise.resolve());
		const fakeArchive = {
			getConfig: vi.fn(() =>
				Promise.resolve({
					fromList: true,
					roots: ['https://example.com/'],
					baseUrl: 'https://example.com/',
				}),
			),
			close: closeSpy,
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		await expect(
			CrawlerOrchestrator.append('/tmp/anything.nitpicker', ['https://example.com/'], {
				cwd: '/tmp',
			}),
		).rejects.toThrow(
			'Cannot append to a list-mode archive: this archive was created with --list/--list-file and contains metadata-only pages. Create a fresh archive instead.',
		);
		expect(closeSpy).toHaveBeenCalledOnce();
	});

	it('resolves a relative archive path against cwd before opening', async () => {
		// A user-supplied `./existing.nitpicker` must be resolved to
		// `<cwd>/existing.nitpicker` before Archive.open sees it; the path
		// is also what the catch path would feed to copyFile, so getting the
		// resolution wrong corrupts both the lock and the .bak naming.
		const closeSpy = vi.fn(() => Promise.resolve());
		const fakeArchive = {
			getConfig: vi.fn(() => Promise.reject(new Error('stop-here'))),
			close: closeSpy,
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		const openSpy = vi
			.spyOn(archiveModule.default, 'open')
			.mockResolvedValueOnce(fakeArchive);

		await expect(
			CrawlerOrchestrator.append('./existing.nitpicker', ['https://example.com/'], {
				cwd: '/tmp/test-cwd',
			}),
		).rejects.toThrow('stop-here');

		expect(openSpy).toHaveBeenCalledOnce();
		const openArg = openSpy.mock.calls[0]![0] as { filePath: string; cwd: string };
		expect(openArg.filePath).toBe('/tmp/test-cwd/existing.nitpicker');
		expect(openArg.cwd).toBe('/tmp/test-cwd');
	});

	it('passes an absolute archive path through unchanged', async () => {
		const closeSpy = vi.fn(() => Promise.resolve());
		const fakeArchive = {
			getConfig: vi.fn(() => Promise.reject(new Error('stop-here'))),
			close: closeSpy,
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		const openSpy = vi
			.spyOn(archiveModule.default, 'open')
			.mockResolvedValueOnce(fakeArchive);

		await expect(
			CrawlerOrchestrator.append(
				'/abs/path/existing.nitpicker',
				['https://example.com/'],
				{
					cwd: '/tmp/test-cwd',
				},
			),
		).rejects.toThrow('stop-here');

		const openArg = openSpy.mock.calls[0]![0] as { filePath: string };
		expect(openArg.filePath).toBe('/abs/path/existing.nitpicker');
	});
});
