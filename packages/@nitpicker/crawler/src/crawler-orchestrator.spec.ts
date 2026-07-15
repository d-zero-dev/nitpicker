import type Archive from './archive/archive.js';
import type { CrawlerError } from './utils/types/types.js';

import fs from 'node:fs/promises';
import path from 'node:path';

import { describe, it, expect, vi, afterEach } from 'vitest';

import { CrawlerOrchestrator } from './crawler-orchestrator.js';

// Every `crawling` / `append` / `resume` / `retryFailed` / `inventory`
// call-site ends with a `populateMigrationTables(archive)` step in
// production so every reader path sees populated 0.13 entity tables.
// These orchestrator unit tests use bare `as unknown as Archive` mocks
// that intentionally omit `getKnex` and the full writer surface —
// running the real populate against them would blow up with
// `accessor.getKnex is not a function`, which is unrelated to the
// event-wiring behaviour the tests exercise. Stub it here at the
// module boundary so the mocks stay minimal.
vi.mock('./archive/populate-migration-tables.js', () => ({
	populateMigrationTables: vi.fn(() => Promise.resolve()),
}));

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

		/**
		 * Captures `resume()` invocations so tests can assert the orchestrator
		 * threaded the right `pagesScrapedOffset` through.
		 * @param pending - Pending URLs from the previous session.
		 * @param scraped - Already-scraped URLs from the previous session.
		 * @param resources - Resource URLs from the previous session.
		 * @param pagesScrapedOffset - Cumulative pagesScraped counter seed.
		 */
		resume(
			pending: string[],
			scraped: string[],
			resources: string[],
			pagesScrapedOffset?: number,
		) {
			fakeCrawlerResumeCalls.push({ pending, scraped, resources, pagesScrapedOffset });
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
 * Per-test record of `Crawler.resume()` invocations. Reset in `afterEach`.
 */
const fakeCrawlerResumeCalls: {
	pending: string[];
	scraped: string[];
	resources: string[];
	pagesScrapedOffset: number | undefined;
}[] = [];

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
	fakeCrawlerResumeCalls.length = 0;
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
	it('routes non-HTML novel URLs through `insertInventoryResources` (bulk) and never HEAD-probes them', async () => {
		// The new inventory orchestrator classifies URLs by extension via
		// `isLikelyHtmlUrl` and writes non-HTML entries through the
		// chunked `insertInventoryResources` bulk path (issue #121
		// review F14 — the old per-URL `setResources` loop spent minutes
		// inside the `.bak` window on 50k-URL inventory lists). This
		// pins three contracts in one shot:
		//
		// 1. `insertInventoryResources` is called once with every
		//    non-HTML novel URL. The all-null-metadata + `'inventory-seed'`
		//    label shape is asserted at the database layer (see
		//    `database.spec.ts > insertInventoryResources`), not here —
		//    this test only verifies the orchestrator routes correctly.
		// 2. The legacy `setResources` per-URL path is NOT taken (a
		//    regression that reverts to it would surface here).
		// 3. NO `fetchDestination` HEAD call is made AND NO `addError`
		//    `crawl_errors` row is written. The orchestrator-side
		//    network failure logging is intentionally absent because no
		//    probe happens.
		const insertInventoryResourcesCalls: { urls: string[] }[] = [];
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
			setResources: vi.fn(() => Promise.resolve()),
			insertInventorySeeds: vi.fn(() => Promise.resolve()),
			insertInventoryResources: vi.fn((urls: readonly { href: string }[]) => {
				insertInventoryResourcesCalls.push({ urls: urls.map((u) => u.href) });
				return Promise.resolve();
			}),
			addError: vi.fn(() => Promise.resolve()),
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

		// Exactly one bulk call carrying every non-HTML novel URL.
		expect(insertInventoryResourcesCalls).toHaveLength(1);
		expect(insertInventoryResourcesCalls[0]?.urls.toSorted()).toEqual([
			'https://example.com/orphan-a.pdf',
			'https://example.com/orphan-b.jpg',
			'https://example.com/orphan-c.css',
			'https://example.com/orphan-d.js',
		]);
		// Legacy per-URL path is NOT taken.
		expect(vi.mocked(fakeArchive.setResources)).not.toHaveBeenCalled();

		// Zero HEAD probes. The whole point of the new design is that
		// the orchestrator does not pre-flight non-HTML URLs.
		expect(fetchSpy).not.toHaveBeenCalled();

		// Zero `addError` calls. The previous code wrote `crawl_errors`
		// rows on HEAD failure; the new code does not probe, so this
		// telemetry surface is intentionally silent for non-HTML
		// inventory URLs.
		const addErrorMock = vi.mocked(fakeArchive.addError);
		expect(addErrorMock).not.toHaveBeenCalled();

		// Audit log: the non-HTML-only success branch MUST still write
		// one `inventory_runs` row with the correct aggregate counts.
		const recordInventoryRunMock = vi.mocked(fakeArchive.recordInventoryRun);
		expect(recordInventoryRunMock).toHaveBeenCalledTimes(1);
		const [meta] = recordInventoryRunMock.mock.calls[0]!;
		expect(meta.total_lines).toBe(4);
		expect(meta.new_pages).toBe(0);
		expect(meta.new_resources).toBe(4);
		expect(meta.scope_skipped).toBe(0);
		expect(meta.list_label).toMatch(/^inventory-/);
	});

	it('aborts the ingestion and re-throws when the audit-log INSERT fails (issue #121: no more swallow)', async () => {
		// Issue #121 inverted the audit-failure contract. The old code
		// wrote the audit row at the *tail* of a successful crawl and
		// swallowed any failure, because re-throwing would have wiped
		// the completed crawl via `.bak` restore. The new code lifts
		// the audit row into the `.bak`-protected ingestion phase, so a
		// failure here CAN restore safely — and SHOULD, to keep the
		// "either the whole ingestion took or none of it did" atomicity
		// at the boundary. This test pins the inversion so a regression
		// that re-adds the swallow surfaces here as a missing throw.
		const insertInventoryResourcesCalls: { urls: string[] }[] = [];
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
			setResources: vi.fn(() => Promise.resolve()),
			insertInventorySeeds: vi.fn(() => Promise.resolve()),
			insertInventoryResources: vi.fn((urls: readonly { href: string }[]) => {
				insertInventoryResourcesCalls.push({ urls: urls.map((u) => u.href) });
				return Promise.resolve();
			}),
			addError: vi.fn(() => Promise.resolve()),
			// The mock throws — simulating a libsql lock / disk error
			// during the audit-row INSERT.
			recordInventoryRun: vi.fn(() => Promise.reject(new Error('simulated libsql lock'))),
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		const testCwd = path.resolve('/tmp/inventory-audit-failure-test');
		await fs.mkdir(testCwd, { recursive: true });
		const fixturePath = path.join(testCwd, 'fixture.nitpicker');
		await fs.writeFile(fixturePath, '');

		try {
			// MUST throw — the orchestrator no longer swallows audit
			// failures. The outer catch path restores `.bak` and
			// re-throws the underlying libsql error.
			await expect(
				CrawlerOrchestrator.inventory(
					'fixture.nitpicker',
					['https://example.com/non-html.pdf'],
					{ cwd: testCwd },
				),
			).rejects.toThrow('simulated libsql lock');
		} finally {
			await fs.rm(testCwd, { recursive: true, force: true });
		}

		// recordInventoryRun WAS attempted — confirming the failure
		// path actually ran (not a false positive on some earlier step).
		expect(vi.mocked(fakeArchive.recordInventoryRun)).toHaveBeenCalledTimes(1);
	});
});

describe('CrawlerOrchestrator.inventory: cumulative pagesScraped offset', () => {
	it('seeds Crawler.resume with archive.getScrapedHtmlPageCount() in the HTML-seed branch', async () => {
		// Inventory previously hard-coded `pagesScrapedOffset = 0`, so the
		// progress header showed `(N)` as a session-only browser-render
		// counter. Operators running inventory against an archive with
		// pre-existing pages misread the small N as "inner pages dropped
		// to N" data loss. The HTML-seed branch must now seed the
		// counter from `getScrapedHtmlPageCount()` so the header reads
		// cumulative (matching `append` / `retryFailed` / `resume`).
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
			getResourceUrlList: vi.fn(() => Promise.resolve([])),
			getScrapedHtmlPageCount: vi.fn(() => Promise.resolve(140_000)),
			listDnsBurnedHostCandidates: vi.fn(() => Promise.resolve([])),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			close: vi.fn(() => Promise.resolve()),
			setResources: vi.fn(() => Promise.resolve()),
			insertInventorySeeds: vi.fn(() => Promise.resolve()),
			insertInventoryResources: vi.fn(() => Promise.resolve()),
			addError: vi.fn(() => Promise.resolve()),
			recordInventoryRun: vi.fn(() => Promise.resolve(1)),
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		// FakeCrawler.start() emits `crawlEnd` (no real network), so the
		// HTML-seed branch reaches `recordInventoryRun` and resolves.
		fakeCrawlerDriver = (crawler) => {
			crawler.handlers.get('crawlEnd')?.(undefined as never);
		};

		const testCwd = path.resolve('/tmp/inventory-pagesscraped-offset-test');
		await fs.mkdir(testCwd, { recursive: true });
		const fixturePath = path.join(testCwd, 'fixture.nitpicker');
		await fs.writeFile(fixturePath, '');

		try {
			await CrawlerOrchestrator.inventory(
				'fixture.nitpicker',
				['https://example.com/new-page.html'],
				{ cwd: testCwd },
			);
		} finally {
			await fs.rm(testCwd, { recursive: true, force: true });
		}

		expect(fakeArchive.getScrapedHtmlPageCount).toHaveBeenCalledTimes(1);
		expect(fakeCrawlerResumeCalls).toHaveLength(1);
		expect(fakeCrawlerResumeCalls[0]?.pagesScrapedOffset).toBe(140_000);
	});
});
