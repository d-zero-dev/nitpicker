import type Archive from './archive/archive.js';
import type { CrawlerError } from './utils/types/types.js';

import fs from 'node:fs/promises';
import path from 'node:path';

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
			const driver = fakeCrawlerDriver;
			if (driver) {
				driver(this);
				return;
			}
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

/**
 * Optional per-test override of the FakeCrawler's `start()` behaviour. When
 * set, the FakeCrawler delegates to this function instead of running its
 * default error-then-crawlEnd emission. Tests should reset it to `null` in
 * `afterEach` to avoid leaking state.
 */
let fakeCrawlerDriver:
	| ((handlers: { handlers: Map<string, (payload: never) => void> }) => void)
	| null = null;

afterEach(() => {
	vi.restoreAllMocks();
	fakeCrawlerDriver = null;
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

describe('CrawlerOrchestrator.crawling: PreloadShortCircuitError', () => {
	it('PreloadShortCircuitError は addError を呼ばずに skip される', async () => {
		// crawl_errors への重複挿入を止めるためのカーブアウト。short-circuit
		// が起きるたびに addError を呼んでしまうと、同じ host の URL ぶんだけ
		// crawl_errors が肥大化し、次回 preload の選定が暴走する。設計の核心
		// 部分なので、これを保証する unit assertion を残す。
		const addError = vi.fn(() => Promise.resolve());
		const fakeArchive = {
			on: vi.fn(),
			setConfig: vi.fn(() => Promise.resolve()),
			getConfig: vi.fn(() => Promise.resolve({ analyze: [] })),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			getResourceByUrl: vi.fn(() => Promise.resolve(null)),
			addError,
			filePath: '/tmp/orchestrator-preload-skip-test.nitpicker',
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'create').mockResolvedValueOnce(fakeArchive);

		const { PreloadShortCircuitError } =
			await import('./crawler/preload-short-circuit-error.js');

		fakeCrawlerDriver = (crawler) => {
			const error: CrawlerError = {
				pid: process.pid,
				isMainProcess: true,
				url: 'https://foo.invalid/page',
				isExternal: false,
				error: new PreloadShortCircuitError('foo.invalid'),
			};
			crawler.handlers.get('error')?.(error as never);
			crawler.handlers.get('crawlEnd')?.(undefined as never);
		};

		await CrawlerOrchestrator.crawling(['https://example.com/'], {
			cwd: '/tmp',
			filePath: '/tmp/orchestrator-preload-skip-test.nitpicker',
		});

		expect(addError).not.toHaveBeenCalled();
	});

	it('PreloadShortCircuitError 以外の error は通常通り addError を呼ぶ（regression guard）', async () => {
		const addError = vi.fn(() => Promise.resolve());
		const fakeArchive = {
			on: vi.fn(),
			setConfig: vi.fn(() => Promise.resolve()),
			getConfig: vi.fn(() => Promise.resolve({ analyze: [] })),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			getResourceByUrl: vi.fn(() => Promise.resolve(null)),
			addError,
			filePath: '/tmp/orchestrator-non-preload-test.nitpicker',
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'create').mockResolvedValueOnce(fakeArchive);

		fakeCrawlerDriver = (crawler) => {
			const error: CrawlerError = {
				pid: process.pid,
				isMainProcess: true,
				url: 'https://example.com/',
				isExternal: false,
				error: new Error('ordinary scrape failure'),
			};
			crawler.handlers.get('error')?.(error as never);
			crawler.handlers.get('crawlEnd')?.(undefined as never);
		};

		await CrawlerOrchestrator.crawling(['https://example.com/'], {
			cwd: '/tmp',
			filePath: '/tmp/orchestrator-non-preload-test.nitpicker',
		});

		expect(addError).toHaveBeenCalledOnce();
	});
});

describe('CrawlerOrchestrator.crawling: pageError ハンドラ', () => {
	it('pageError イベントが archive.addPageError 経由で書き込まれる', async () => {
		const addPageError = vi.fn(() => Promise.resolve());
		const fakeArchive = {
			on: vi.fn(),
			setConfig: vi.fn(() => Promise.resolve()),
			getConfig: vi.fn(() => Promise.resolve({ analyze: [] })),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			getResourceByUrl: vi.fn(() => Promise.resolve(null)),
			addPageError,
			filePath: '/tmp/orchestrator-pageerror-test.nitpicker',
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'create').mockResolvedValueOnce(fakeArchive);

		fakeCrawlerDriver = (crawler) => {
			crawler.handlers.get('pageError')?.({
				url: 'https://example.com/page',
				phase: 'retryExhausted',
				message: '📷 mobile-small: skipped — Attempted to use detached Frame',
				isExternal: false,
			} as never);
			crawler.handlers.get('crawlEnd')?.(undefined as never);
		};

		await CrawlerOrchestrator.crawling(['https://example.com/'], {
			cwd: '/tmp',
			filePath: '/tmp/orchestrator-pageerror-test.nitpicker',
		});

		expect(addPageError).toHaveBeenCalledExactlyOnceWith(
			'https://example.com/page',
			'retryExhausted',
			'📷 mobile-small: skipped — Attempted to use detached Frame',
			false,
		);
	});

	it('archive.addPageError が reject すると crawling() 全体が reject する', async () => {
		const fakeArchive = {
			on: vi.fn(),
			setConfig: vi.fn(() => Promise.resolve()),
			getConfig: vi.fn(() => Promise.resolve({ analyze: [] })),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			getResourceByUrl: vi.fn(() => Promise.resolve(null)),
			addPageError: vi.fn(() => Promise.reject(new Error('db-page-error-failure'))),
			filePath: '/tmp/orchestrator-pageerror-reject-test.nitpicker',
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'create').mockResolvedValueOnce(fakeArchive);

		fakeCrawlerDriver = (crawler) => {
			crawler.handlers.get('pageError')?.({
				url: 'https://example.com/page',
				phase: 'retryExhausted',
				message: 'oops',
				isExternal: false,
			} as never);
			crawler.handlers.get('crawlEnd')?.(undefined as never);
		};

		await expect(
			CrawlerOrchestrator.crawling(['https://example.com/'], {
				cwd: '/tmp',
				filePath: '/tmp/orchestrator-pageerror-reject-test.nitpicker',
			}),
		).rejects.toThrow('db-page-error-failure');
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

describe('CrawlerOrchestrator.inventory: pending guard demote', () => {
	it('warns instead of throwing when the archive carries pending placeholder URLs', async () => {
		// The original guard threw whenever `pending.length > 0`, which blocked
		// every inventory run on an archive that had leaked predicted-discard
		// placeholders (`crawler.ts:980` emits no 'skip', so the rows stay
		// `scraped=0` and `--retry-failed` cannot clear them). The new
		// behaviour warns and proceeds — crawled-wins source priority keeps
		// stale labels stable. Drive the orchestrator with an inventory list
		// that resolves to zero novel URLs so the no-op early-return path
		// fires immediately after the guard, isolating the guard's branch.
		const fakeArchive = {
			on: vi.fn(),
			getConfig: vi.fn(() =>
				Promise.resolve({
					name: 'fixture',
					baseUrl: 'https://example.com',
					roots: ['https://example.com/'],
					recursive: true,
					interval: 0,
					image: false,
					fetchExternal: false,
					parallels: 1,
					excludes: [],
					excludeKeywords: [],
					excludeUrls: [],
					maxExcludedDepth: 10,
					retry: 0,
					fromList: false,
					disableQueries: false,
					userAgent: 'test',
					ignoreRobots: true,
				}),
			),
			getCrawlingState: vi.fn(() =>
				Promise.resolve({
					scraped: [],
					pending: ['https://example.com/leaked-placeholder'],
				}),
			),
			getExistingPageUrls: vi.fn(() =>
				Promise.resolve(['https://example.com/already-known']),
			),
			getExistingResourceUrls: vi.fn(() => Promise.resolve([])),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			close: vi.fn(() => Promise.resolve()),
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		// All inventory URLs match `getExistingPageUrls` → `novelUrls === []`
		// → the orchestrator hits the no-op early return without taking the
		// `.bak` or invoking the Crawler. Any throw from the pending check
		// would short-circuit before that point.
		await expect(
			CrawlerOrchestrator.inventory(
				'fixture.nitpicker',
				['https://example.com/already-known'],
				{
					cwd: '/tmp/inventory-pending-guard-test',
				},
			),
		).resolves.toBeDefined();

		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringMatching(/pending URLs from a previous crawl/),
		);
	});

	it('does NOT warn when the archive has no pending URLs', async () => {
		// Regression guard: the warn message must only fire when there is an
		// actual pending row. A stray warn on every inventory call would
		// drown the operator in false-positive noise.
		const fakeArchive = {
			on: vi.fn(),
			getConfig: vi.fn(() =>
				Promise.resolve({
					name: 'fixture',
					baseUrl: 'https://example.com',
					roots: ['https://example.com/'],
					recursive: true,
					interval: 0,
					image: false,
					fetchExternal: false,
					parallels: 1,
					excludes: [],
					excludeKeywords: [],
					excludeUrls: [],
					maxExcludedDepth: 10,
					retry: 0,
					fromList: false,
					disableQueries: false,
					userAgent: 'test',
					ignoreRobots: true,
				}),
			),
			getCrawlingState: vi.fn(() => Promise.resolve({ scraped: [], pending: [] })),
			getExistingPageUrls: vi.fn(() =>
				Promise.resolve(['https://example.com/already-known']),
			),
			getExistingResourceUrls: vi.fn(() => Promise.resolve([])),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			close: vi.fn(() => Promise.resolve()),
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await expect(
			CrawlerOrchestrator.inventory(
				'fixture.nitpicker',
				['https://example.com/already-known'],
				{
					cwd: '/tmp/inventory-no-pending-test',
				},
			),
		).resolves.toBeDefined();

		expect(warnSpy).not.toHaveBeenCalled();
	});
});

describe('CrawlerOrchestrator.inventory: non-HTML metadata contract', () => {
	it('records non-HTML novel URLs as `setResources` rows with all-null metadata and NO HEAD probe', async () => {
		// F4 + F5: the new inventory orchestrator classifies URLs by
		// extension via `isLikelyHtmlUrl` and writes non-HTML entries
		// directly into `resources` without a HEAD probe. This pins
		// three contracts in one shot:
		//
		// 1. `setResources` is called for each non-HTML novel URL with
		//    `source: 'inventory-seed'`.
		// 2. The recorded row carries `status / statusText / contentType
		//    / contentLength / headers === null` — downstream consumers
		//    must treat this as "not probed" rather than "probed and
		//    failed".
		// 3. NO `fetchDestination` HEAD call is made AND NO `addError`
		//    `crawl_errors` row is written. The orchestrator-side
		//    network failure logging is intentionally absent because no
		//    probe happens.
		//
		// Pin in one test so a regression that restores HEAD-based
		// metadata (and the associated `addError` logging) fails
		// loudly here.
		const setResourcesCalls: {
			url: string;
			source: string | undefined;
			resource: unknown;
		}[] = [];
		const fakeArchive = {
			on: vi.fn(),
			getConfig: vi.fn(() =>
				Promise.resolve({
					name: 'fixture',
					baseUrl: 'https://example.com',
					roots: ['https://example.com/'],
					recursive: true,
					interval: 0,
					image: false,
					fetchExternal: false,
					parallels: 1,
					excludes: [],
					excludeKeywords: [],
					excludeUrls: [],
					maxExcludedDepth: 10,
					retry: 0,
					fromList: false,
					disableQueries: false,
					userAgent: 'test',
					ignoreRobots: true,
				}),
			),
			getCrawlingState: vi.fn(() => Promise.resolve({ scraped: [], pending: [] })),
			getExistingPageUrls: vi.fn(() => Promise.resolve([])),
			getExistingResourceUrls: vi.fn(() => Promise.resolve([])),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			close: vi.fn(() => Promise.resolve()),
			setResources: vi.fn(
				(resource: { url: { href: string } }, source: string | undefined) => {
					setResourcesCalls.push({ url: resource.url.href, source, resource });
					return Promise.resolve();
				},
			),
			addError: vi.fn(() => Promise.resolve()),
			// Phase 1 audit log: the orchestrator records one row per
			// successful inventory run via `recordInventoryRun`. The mock
			// just needs to resolve — the row content is exercised by
			// `database.spec.ts` and the inventory E2E.
			recordInventoryRun: vi.fn(() => Promise.resolve(1)),
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		const fetchDestMod = await import('./crawler/fetch-destination.js');
		const fetchSpy = vi.spyOn(fetchDestMod, 'fetchDestination');

		// The orchestrator copies the archive to a `.bak` before
		// processing novel URLs. The Archive instance itself is mocked,
		// but the copyFile happens at the filesystem layer — create a
		// throwaway file so the copy succeeds.
		const testCwd = path.resolve('/tmp/inventory-non-html-contract-test');
		await fs.mkdir(testCwd, { recursive: true });
		const fixturePath = path.join(testCwd, 'fixture.nitpicker');
		await fs.writeFile(fixturePath, '');

		try {
			// All four URLs are non-HTML (extension-based classification
			// drops them into the `setResources` path) and all are novel
			// (`getExistingPageUrls` / `getExistingResourceUrls` return
			// empty). So `htmlSeeds.length === 0`, the orchestrator hits
			// the no-op early return after writing the resource rows.
			await CrawlerOrchestrator.inventory(
				'fixture.nitpicker',
				[
					'https://example.com/orphan-a.pdf',
					'https://example.com/orphan-b.jpg',
					'https://example.com/orphan-c.css',
					'https://example.com/orphan-d.js',
				],
				{ cwd: testCwd },
			);
		} finally {
			await fs.rm(testCwd, { recursive: true, force: true });
		}

		// Four `setResources` calls, all labelled `'inventory-seed'`.
		expect(setResourcesCalls).toHaveLength(4);
		for (const call of setResourcesCalls) {
			expect(call.source).toBe('inventory-seed');
			const resource = call.resource as {
				status: number | null;
				statusText: string | null;
				contentType: string | null;
				contentLength: number | null;
				headers: unknown;
			};
			expect(resource.status).toBeNull();
			expect(resource.statusText).toBeNull();
			expect(resource.contentType).toBeNull();
			expect(resource.contentLength).toBeNull();
			expect(resource.headers).toBeNull();
		}

		// Zero HEAD probes. The whole point of the new design is that
		// the orchestrator does not pre-flight non-HTML URLs.
		expect(fetchSpy).not.toHaveBeenCalled();

		// Zero `addError` calls. The previous code wrote `crawl_errors`
		// rows on HEAD failure; the new code does not probe, so this
		// telemetry surface is intentionally silent for non-HTML
		// inventory URLs.
		const addErrorMock = vi.mocked(fakeArchive.addError);
		expect(addErrorMock).not.toHaveBeenCalled();

		// Phase 1 audit log: the non-HTML-only success branch MUST
		// still write one `inventory_runs` row with the correct
		// aggregate counts. Pin the call shape so a future refactor
		// that drops `#writeInventoryRunRow` from this branch surfaces
		// here — without this assertion the mock provided above would
		// silently absorb a missing call.
		const recordInventoryRunMock = vi.mocked(fakeArchive.recordInventoryRun);
		expect(recordInventoryRunMock).toHaveBeenCalledTimes(1);
		const [meta] = recordInventoryRunMock.mock.calls[0]!;
		expect(meta.total_lines).toBe(4);
		expect(meta.new_pages).toBe(0);
		expect(meta.new_resources).toBe(4);
		expect(meta.scope_skipped).toBe(0);
		expect(meta.list_label).toMatch(/^inventory-/);
	});

	it('preserves successful ingestion when the audit-log INSERT fails (swallows, never rolls back)', async () => {
		// The audit-log row is non-essential — the ingestion has
		// already committed by the time #writeInventoryRunRow runs.
		// If `recordInventoryRun` throws (libsql hiccup, transient
		// lock), the orchestrator MUST swallow the error and return
		// normally rather than letting the outer catch restore from
		// `.bak` and wipe the user's crawl. This test pins that
		// failure-tolerance contract; without it a regression that
		// removed the try/catch in #writeInventoryRunRow would
		// silently turn audit failures into data-loss events.
		const setResourcesCalls: { url: string }[] = [];
		const fakeArchive = {
			on: vi.fn(),
			getConfig: vi.fn(() =>
				Promise.resolve({
					name: 'fixture',
					baseUrl: 'https://example.com',
					roots: ['https://example.com/'],
					recursive: true,
					interval: 0,
					image: false,
					fetchExternal: false,
					parallels: 1,
					excludes: [],
					excludeKeywords: [],
					excludeUrls: [],
					maxExcludedDepth: 10,
					retry: 0,
					fromList: false,
					disableQueries: false,
					userAgent: 'test',
					ignoreRobots: true,
				}),
			),
			getCrawlingState: vi.fn(() => Promise.resolve({ scraped: [], pending: [] })),
			getExistingPageUrls: vi.fn(() => Promise.resolve([])),
			getExistingResourceUrls: vi.fn(() => Promise.resolve([])),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			close: vi.fn(() => Promise.resolve()),
			setResources: vi.fn((resource: { url: { href: string } }) => {
				setResourcesCalls.push({ url: resource.url.href });
				return Promise.resolve();
			}),
			addError: vi.fn(() => Promise.resolve()),
			// The mock throws — simulating a libsql lock / disk error.
			recordInventoryRun: vi.fn(() => Promise.reject(new Error('simulated libsql lock'))),
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		const testCwd = path.resolve('/tmp/inventory-audit-failure-test');
		await fs.mkdir(testCwd, { recursive: true });
		const fixturePath = path.join(testCwd, 'fixture.nitpicker');
		await fs.writeFile(fixturePath, '');

		try {
			// MUST NOT throw — the orchestrator swallows the audit
			// failure and returns the orchestrator instance normally.
			await expect(
				CrawlerOrchestrator.inventory(
					'fixture.nitpicker',
					['https://example.com/non-html.pdf'],
					{ cwd: testCwd },
				),
			).resolves.toBeDefined();
		} finally {
			await fs.rm(testCwd, { recursive: true, force: true });
		}

		// The ingestion side-effect (`setResources`) was preserved
		// despite the audit failure.
		expect(setResourcesCalls).toHaveLength(1);
		// recordInventoryRun WAS attempted — confirming the failure
		// path actually ran.
		expect(vi.mocked(fakeArchive.recordInventoryRun)).toHaveBeenCalledTimes(1);
	});
});
