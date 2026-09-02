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

		/**
		 * Captures the options object the orchestrator constructed this
		 * instance with, so tests can assert option-forwarding regressions
		 * (e.g. the network-outage thresholds / probe) without a real
		 * `Crawler`.
		 * @param options - The options passed to `new Crawler(...)`.
		 */
		constructor(options?: unknown) {
			fakeCrawlerConstructorCalls.push(options);
		}

		/** No-op abort to satisfy the orchestrator's interface. */
		abort() {}

		/**
		 * Returns an empty rejection map, matching a crawl where
		 * `--dedupe-cap` never capped any shape.
		 * @returns An empty `Map`.
		 */
		getDedupeCapRejections() {
			return new Map<string, number>();
		}
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
 * Per-test record of the options object each `new Crawler(...)` construction
 * received. Reset in `afterEach`.
 */
const fakeCrawlerConstructorCalls: unknown[] = [];

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
	fakeCrawlerConstructorCalls.length = 0;
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

describe('CrawlerOrchestrator.crawling: networkOutageConfirmed / networkOutageRecovered', () => {
	it('confirmed → archive.insertNetworkOutage が呼ばれ、その id が recovered での closeNetworkOutage に使われる', async () => {
		const insertNetworkOutage = vi.fn(() => Promise.resolve(42));
		const closeNetworkOutage = vi.fn(() => Promise.resolve());
		const fakeArchive = {
			on: vi.fn(),
			setConfig: vi.fn(() => Promise.resolve()),
			getConfig: vi.fn(() => Promise.resolve({ analyze: [] })),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			getResourceByUrl: vi.fn(() => Promise.resolve(null)),
			insertNetworkOutage,
			closeNetworkOutage,
			filePath: '/tmp/orchestrator-outage-test.nitpicker',
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'create').mockResolvedValueOnce(fakeArchive);

		fakeCrawlerDriver = (crawler) => {
			crawler.handlers.get('networkOutageConfirmed')?.({
				startedAt: 100,
				detectedAt: 200,
				probeHost: 'a.example',
				triggerErrorCount: 5,
				triggerHostCount: 2,
			} as never);
			crawler.handlers.get('networkOutageRecovered')?.({ endedAt: 1500 } as never);
			crawler.handlers.get('crawlEnd')?.(undefined as never);
		};

		await CrawlerOrchestrator.crawling(['https://example.com/'], {
			cwd: '/tmp',
			filePath: '/tmp/orchestrator-outage-test.nitpicker',
		});

		expect(insertNetworkOutage).toHaveBeenCalledWith({
			startedAt: 100,
			detectedAt: 200,
			probeHost: 'a.example',
			triggerErrorCount: 5,
			triggerHostCount: 2,
		});
		expect(closeNetworkOutage).toHaveBeenCalledWith(42, 1500);
	});

	it('recovered イベントに対応する confirmed が無い場合は closeNetworkOutage を呼ばない（防御的no-op）', async () => {
		const insertNetworkOutage = vi.fn(() => Promise.resolve(42));
		const closeNetworkOutage = vi.fn(() => Promise.resolve());
		const fakeArchive = {
			on: vi.fn(),
			setConfig: vi.fn(() => Promise.resolve()),
			getConfig: vi.fn(() => Promise.resolve({ analyze: [] })),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			getResourceByUrl: vi.fn(() => Promise.resolve(null)),
			insertNetworkOutage,
			closeNetworkOutage,
			filePath: '/tmp/orchestrator-outage-orphan-test.nitpicker',
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'create').mockResolvedValueOnce(fakeArchive);

		fakeCrawlerDriver = (crawler) => {
			// No matching 'networkOutageConfirmed' fired first.
			crawler.handlers.get('networkOutageRecovered')?.({ endedAt: 1500 } as never);
			crawler.handlers.get('crawlEnd')?.(undefined as never);
		};

		await CrawlerOrchestrator.crawling(['https://example.com/'], {
			cwd: '/tmp',
			filePath: '/tmp/orchestrator-outage-orphan-test.nitpicker',
		});

		expect(closeNetworkOutage).not.toHaveBeenCalled();
	});

	it('accumulates the confirmed count and duration into networkOutageSummaryCounter, reset after the session', async () => {
		const fakeArchive = {
			on: vi.fn(),
			setConfig: vi.fn(() => Promise.resolve()),
			getConfig: vi.fn(() => Promise.resolve({ analyze: [] })),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			getResourceByUrl: vi.fn(() => Promise.resolve(null)),
			insertNetworkOutage: vi.fn(() => Promise.resolve(7)),
			closeNetworkOutage: vi.fn(() => Promise.resolve()),
			filePath: '/tmp/orchestrator-outage-summary-test.nitpicker',
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'create').mockResolvedValueOnce(fakeArchive);

		const { networkOutageSummaryCounter } =
			await import('./crawler/network-outage-summary-counter.js');

		fakeCrawlerDriver = (crawler) => {
			crawler.handlers.get('networkOutageConfirmed')?.({
				startedAt: 1000,
				detectedAt: 1100,
				probeHost: 'a.example',
				triggerErrorCount: 5,
				triggerHostCount: 2,
			} as never);
			crawler.handlers.get('networkOutageRecovered')?.({ endedAt: 6000 } as never);
			crawler.handlers.get('crawlEnd')?.(undefined as never);
		};

		await CrawlerOrchestrator.crawling(['https://example.com/'], {
			cwd: '/tmp',
			filePath: '/tmp/orchestrator-outage-summary-test.nitpicker',
		});

		// The summary is printed and reset to 0 by `#finalizeCrawlSession`
		// before `crawling()` resolves, so by the time we get here the
		// counter must already be back at its zero baseline.
		expect(networkOutageSummaryCounter.confirmedCount).toBe(0);
		expect(networkOutageSummaryCounter.totalDurationMs).toBe(0);
	});
});

describe('CrawlerOrchestrator.crawling: network-outage option forwarding (regression)', () => {
	it('forwards networkOutage* thresholds and networkProbe from crawling() options to the underlying Crawler — regression test for issue #91 (these were previously silently dropped, so callers had no way to configure them outside unit tests that construct Crawler directly)', async () => {
		const fakeArchive = {
			on: vi.fn(),
			setConfig: vi.fn(() => Promise.resolve()),
			getConfig: vi.fn(() => Promise.resolve({ analyze: [] })),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			getResourceByUrl: vi.fn(() => Promise.resolve(null)),
			addError: vi.fn(() => Promise.resolve()),
			filePath: '/tmp/orchestrator-network-outage-options-test.nitpicker',
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'create').mockResolvedValueOnce(fakeArchive);

		const fakeProbe = vi.fn(() => Promise.resolve(true));

		await CrawlerOrchestrator.crawling(['https://example.com/'], {
			cwd: '/tmp',
			filePath: '/tmp/orchestrator-network-outage-options-test.nitpicker',
			networkOutageWindowMs: 1234,
			networkOutageErrorThreshold: 7,
			networkOutageHostThreshold: 3,
			networkOutageProbeIntervalMs: 5678,
			networkProbe: fakeProbe,
		});

		expect(fakeCrawlerConstructorCalls).toHaveLength(1);
		expect(fakeCrawlerConstructorCalls[0]).toMatchObject({
			networkOutageWindowMs: 1234,
			networkOutageErrorThreshold: 7,
			networkOutageHostThreshold: 3,
			networkOutageProbeIntervalMs: 5678,
			networkProbe: fakeProbe,
		});
	});

	it('omits the network-outage fields (passes undefined) when crawling() options do not set them, letting Crawler apply its own defaults', async () => {
		const fakeArchive = {
			on: vi.fn(),
			setConfig: vi.fn(() => Promise.resolve()),
			getConfig: vi.fn(() => Promise.resolve({ analyze: [] })),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			getResourceByUrl: vi.fn(() => Promise.resolve(null)),
			addError: vi.fn(() => Promise.resolve()),
			filePath: '/tmp/orchestrator-network-outage-defaults-test.nitpicker',
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'create').mockResolvedValueOnce(fakeArchive);

		await CrawlerOrchestrator.crawling(['https://example.com/'], {
			cwd: '/tmp',
			filePath: '/tmp/orchestrator-network-outage-defaults-test.nitpicker',
		});

		expect(fakeCrawlerConstructorCalls).toHaveLength(1);
		expect(fakeCrawlerConstructorCalls[0]).toMatchObject({
			networkOutageWindowMs: undefined,
			networkOutageErrorThreshold: undefined,
			networkOutageHostThreshold: undefined,
			networkOutageProbeIntervalMs: undefined,
			networkProbe: null,
		});
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
		const openArg = openSpy.mock.calls[0]![0] as {
			filePath: string;
			cwd: string;
			openPluginData?: boolean;
		};
		expect(openArg.filePath).toBe('/tmp/test-cwd/existing.nitpicker');
		expect(openArg.cwd).toBe('/tmp/test-cwd');
		// `openPluginData: true` — otherwise a re-write would silently drop
		// any non-`db.sqlite` tar entry (analyze output, a saved inventory
		// list) from the archive (issue #99 regression guard).
		expect(openArg.openPluginData).toBe(true);
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

		const openArg = openSpy.mock.calls[0]![0] as {
			filePath: string;
			openPluginData?: boolean;
		};
		expect(openArg.filePath).toBe('/abs/path/existing.nitpicker');
		expect(openArg.openPluginData).toBe(true);
	});
});

describe('CrawlerOrchestrator.inventory: pending guard demote', () => {
	it('warns instead of throwing when the archive carries pending placeholder URLs', async () => {
		// A guard that throws whenever `pending.length > 0` would block
		// every inventory run on an archive that had leaked predicted-discard
		// placeholders (the predicted-discard path in `crawler.ts` emits no
		// 'skip', so the rows stay
		// `scraped=0` and `--retry-failed` cannot clear them). The guard
		// therefore warns and proceeds — crawled-wins source priority keeps
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

	it('routes the pending-URL warning through setupProgress.onLog instead of console.warn when a setup TaskList row is active (issue #294 code review)', async () => {
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
		const onLog = vi.fn();

		await expect(
			CrawlerOrchestrator.inventory(
				'fixture.nitpicker',
				['https://example.com/already-known'],
				{ cwd: '/tmp/inventory-pending-on-log-test' },
				undefined,
				null,
				{ onLog },
			),
		).resolves.toBeDefined();

		expect(onLog).toHaveBeenCalledWith(
			expect.stringMatching(/pending URLs from a previous crawl/),
		);
		expect(warnSpy).not.toHaveBeenCalled();
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
		// The inventory orchestrator classifies URLs by extension via
		// `isLikelyHtmlUrl` and writes non-HTML entries through the
		// chunked `insertInventoryResources` bulk path (issue #121 —
		// a per-URL `setResources` loop would spend minutes
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
			insertInventorySkippedPages: vi.fn(() => Promise.resolve()),
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

		// Zero `addError` calls. HEAD-failure `crawl_errors` rows would
		// require a probe, and this design does not probe — the
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
		// No `source` was passed (5th arg omitted) — there is no source file
		// to have had invalid lines, so this must be NULL, not 0.
		expect(meta.invalid_skipped).toBeNull();
		expect(meta.list_label).toMatch(/^inventory-/);
	});

	it('aborts the ingestion and re-throws when the audit-log INSERT fails (issue #121: audit failures are not swallowed)', async () => {
		// The audit-failure contract (issue #121): the audit row is
		// written inside the `.bak`-protected ingestion phase, so a
		// failure here CAN restore safely — and SHOULD, to keep the
		// "either the whole ingestion took or none of it did" atomicity
		// at the boundary. Swallowing would only be justified if the
		// audit ran at the tail of a successful crawl, where re-throwing
		// would wipe the completed crawl via `.bak` restore. This test
		// pins the contract so a regression
		// that re-adds a swallow surfaces here as a missing throw.
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
			insertInventorySkippedPages: vi.fn(() => Promise.resolve()),
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
		// With a hard-coded `pagesScrapedOffset = 0`, the
		// progress header would show `(N)` as a session-only browser-render
		// counter, and operators running inventory against an archive with
		// pre-existing pages would misread the small N as "inner pages
		// dropped to N" data loss. The HTML-seed branch must seed the
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
			listDedupeCapShapeKeys: vi.fn(() => Promise.resolve([])),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			close: vi.fn(() => Promise.resolve()),
			setResources: vi.fn(() => Promise.resolve()),
			insertInventorySeeds: vi.fn(() => Promise.resolve()),
			insertInventorySkippedPages: vi.fn(() => Promise.resolve()),
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

describe('CrawlerOrchestrator.inventory: excludes / excludeUrls filtering (issue #260)', () => {
	/**
	 * Builds the mocked Archive shared by the exclusion-filter tests. Every
	 * write-side method is a spy so the tests can assert exactly which URLs
	 * were ingested.
	 * @param config - Overrides merged into the archived config (e.g. `excludes`).
	 * @returns The fake Archive instance.
	 */
	function buildFakeArchive(config: Record<string, unknown>) {
		return {
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
					...config,
				}),
			),
			getCrawlingState: vi.fn(() => Promise.resolve({ scraped: [], pending: [] })),
			getExistingPageUrls: vi.fn(() => Promise.resolve([])),
			getExistingResourceUrls: vi.fn(() => Promise.resolve([])),
			getResourceUrlList: vi.fn(() => Promise.resolve([])),
			getScrapedHtmlPageCount: vi.fn(() => Promise.resolve(0)),
			listDnsBurnedHostCandidates: vi.fn(() => Promise.resolve([])),
			listDedupeCapShapeKeys: vi.fn(() => Promise.resolve([])),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			close: vi.fn(() => Promise.resolve()),
			setResources: vi.fn(() => Promise.resolve()),
			insertInventorySeeds: vi.fn(() => Promise.resolve()),
			insertInventorySkippedPages: vi.fn(() => Promise.resolve()),
			insertInventoryResources: vi.fn(() => Promise.resolve()),
			addError: vi.fn(() => Promise.resolve()),
			recordInventoryRun: vi.fn(() => Promise.resolve(1)),
		} as unknown as Archive;
	}

	it('アーカイブ設定の excludes / excludeUrls にマッチする URL は seed / resource ではなく skipped ページとして記録され exclude_skipped に計上される', async () => {
		// Without the ingestion-side split, the glob-excluded PDF would land
		// in `resources` as a REAL resource row (non-HTML URLs never reach
		// the crawler's fetch-time `shouldSkipUrl` gate), and the
		// prefix-excluded HTML URL would be pre-inserted as a pending
		// `inventory-seed` page. Both must instead reach the same terminal
		// state a link-discovered excluded URL gets in a normal crawl: a
		// skipped page row, written via `insertInventorySkippedPages`.
		const fakeArchive = buildFakeArchive({
			excludes: ['/private/*'],
			excludeUrls: ['https://example.com/legacy'],
		});

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		// The surviving HTML seed drives the HTML-seed branch; emit `crawlEnd`
		// immediately so `inventory` resolves without a real crawl.
		fakeCrawlerDriver = (crawler) => {
			crawler.handlers.get('crawlEnd')?.(undefined as never);
		};

		const testCwd = path.resolve('/tmp/inventory-exclude-filter-test');
		await fs.mkdir(testCwd, { recursive: true });
		const fixturePath = path.join(testCwd, 'fixture.nitpicker');
		await fs.writeFile(fixturePath, '');

		try {
			await CrawlerOrchestrator.inventory(
				'fixture.nitpicker',
				[
					'https://example.com/private/doc.pdf',
					'https://example.com/legacy/page.html',
					'https://example.com/keep.pdf',
					'https://example.com/keep.html',
					'https://other.example/out.pdf',
				],
				{ cwd: testCwd },
			);
		} finally {
			await fs.rm(testCwd, { recursive: true, force: true });
		}

		// Only the non-excluded, in-scope URLs are imported…
		const resourceCalls = vi.mocked(fakeArchive.insertInventoryResources).mock.calls;
		expect(resourceCalls).toHaveLength(1);
		expect(resourceCalls[0]![0].map((u: { href: string }) => u.href)).toEqual([
			'https://example.com/keep.pdf',
		]);
		const seedCalls = vi.mocked(fakeArchive.insertInventorySeeds).mock.calls;
		expect(seedCalls).toHaveLength(1);
		expect(seedCalls[0]![0].map((u: { href: string }) => u.href)).toEqual([
			'https://example.com/keep.html',
		]);
		// …and the excluded ones are recorded as skipped pages instead
		// (HTML and non-HTML alike — the split happens before the
		// extension classification).
		const skippedCalls = vi.mocked(fakeArchive.insertInventorySkippedPages).mock.calls;
		expect(skippedCalls).toHaveLength(1);
		expect(skippedCalls[0]![0].map((u: { href: string }) => u.href).toSorted()).toEqual([
			'https://example.com/legacy/page.html',
			'https://example.com/private/doc.pdf',
		]);

		// The audit row separates the three drop reasons.
		const recordInventoryRunMock = vi.mocked(fakeArchive.recordInventoryRun);
		expect(recordInventoryRunMock).toHaveBeenCalledTimes(1);
		const [meta] = recordInventoryRunMock.mock.calls[0]!;
		expect(meta.total_lines).toBe(5);
		expect(meta.new_pages).toBe(1);
		expect(meta.new_resources).toBe(1);
		expect(meta.scope_skipped).toBe(1);
		expect(meta.exclude_skipped).toBe(2);
	});

	it('スコープ外かつ除外一致の URL は scope_skipped にのみ計上される（二重計上しない）', async () => {
		// The classification order is a documented contract: scope first,
		// exclusion second. A URL that is both out-of-scope AND
		// exclude-matching must land in exactly one audit bucket, or the
		// audit row's counts stop reconciling against `total_lines`.
		const fakeArchive = buildFakeArchive({
			excludes: ['/private/*'],
		});

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		const testCwd = path.resolve('/tmp/inventory-exclude-precedence-test');
		await fs.mkdir(testCwd, { recursive: true });
		const fixturePath = path.join(testCwd, 'fixture.nitpicker');
		await fs.writeFile(fixturePath, '');

		try {
			await CrawlerOrchestrator.inventory(
				'fixture.nitpicker',
				['https://other.example/private/both.pdf', 'https://example.com/ok.pdf'],
				{ cwd: testCwd },
			);
		} finally {
			await fs.rm(testCwd, { recursive: true, force: true });
		}

		// The out-of-scope URL is dropped entirely, never recorded as a
		// skipped page (the skipped-page write receives an empty list).
		const skippedCalls = vi.mocked(fakeArchive.insertInventorySkippedPages).mock.calls;
		expect(skippedCalls).toHaveLength(1);
		expect(skippedCalls[0]![0]).toEqual([]);

		const recordInventoryRunMock = vi.mocked(fakeArchive.recordInventoryRun);
		expect(recordInventoryRunMock).toHaveBeenCalledTimes(1);
		const [meta] = recordInventoryRunMock.mock.calls[0]!;
		expect(meta.scope_skipped).toBe(1);
		expect(meta.exclude_skipped).toBe(0);
		expect(meta.new_resources).toBe(1);
	});

	it('既存 URL は除外判定より先に既知として除去され、skipped 上書きされない（crawled-wins）', async () => {
		// Ordering contract: known-URL subtraction runs BEFORE the
		// exclusion split. A previously crawled page whose URL newly
		// matches the exclusion config must stay untouched — neither
		// re-imported nor re-labelled as skipped — and must not inflate
		// `exclude_skipped`.
		const fakeArchive = buildFakeArchive({
			excludes: ['/private/*'],
		});
		vi.mocked(fakeArchive.getExistingPageUrls).mockResolvedValue([
			'https://example.com/private/known.html',
		]);

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		const testCwd = path.resolve('/tmp/inventory-exclude-known-test');
		await fs.mkdir(testCwd, { recursive: true });
		const fixturePath = path.join(testCwd, 'fixture.nitpicker');
		await fs.writeFile(fixturePath, '');

		try {
			await CrawlerOrchestrator.inventory(
				'fixture.nitpicker',
				['https://example.com/private/known.html', 'https://example.com/ok.pdf'],
				{ cwd: testCwd },
			);
		} finally {
			await fs.rm(testCwd, { recursive: true, force: true });
		}

		const skippedCalls = vi.mocked(fakeArchive.insertInventorySkippedPages).mock.calls;
		expect(skippedCalls).toHaveLength(1);
		expect(skippedCalls[0]![0]).toEqual([]);

		const recordInventoryRunMock = vi.mocked(fakeArchive.recordInventoryRun);
		expect(recordInventoryRunMock).toHaveBeenCalledTimes(1);
		const [meta] = recordInventoryRunMock.mock.calls[0]!;
		expect(meta.exclude_skipped).toBe(0);
		expect(meta.new_resources).toBe(1);
	});

	it('実行時 options の excludes 上書きも適用される（アーカイブ設定に無いパターンでも弾く）', async () => {
		// Parity with the scrape phase: the orchestrator constructor merges
		// run-time overrides over the archived config before building the
		// Crawler's fetch-time gate, so the ingestion-side filter must honour
		// the same merge.
		const fakeArchive = buildFakeArchive({});

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		const testCwd = path.resolve('/tmp/inventory-exclude-override-test');
		await fs.mkdir(testCwd, { recursive: true });
		const fixturePath = path.join(testCwd, 'fixture.nitpicker');
		await fs.writeFile(fixturePath, '');

		try {
			await CrawlerOrchestrator.inventory(
				'fixture.nitpicker',
				['https://example.com/blocked/a.pdf', 'https://example.com/ok.pdf'],
				{ cwd: testCwd, excludes: ['/blocked/*'] },
			);
		} finally {
			await fs.rm(testCwd, { recursive: true, force: true });
		}

		const resourceCalls = vi.mocked(fakeArchive.insertInventoryResources).mock.calls;
		expect(resourceCalls).toHaveLength(1);
		expect(resourceCalls[0]![0].map((u: { href: string }) => u.href)).toEqual([
			'https://example.com/ok.pdf',
		]);
		const skippedCalls = vi.mocked(fakeArchive.insertInventorySkippedPages).mock.calls;
		expect(skippedCalls).toHaveLength(1);
		expect(skippedCalls[0]![0].map((u: { href: string }) => u.href)).toEqual([
			'https://example.com/blocked/a.pdf',
		]);

		const recordInventoryRunMock = vi.mocked(fakeArchive.recordInventoryRun);
		expect(recordInventoryRunMock).toHaveBeenCalledTimes(1);
		const [meta] = recordInventoryRunMock.mock.calls[0]!;
		expect(meta.new_resources).toBe(1);
		expect(meta.exclude_skipped).toBe(1);
		expect(meta.scope_skipped).toBe(0);
	});
});

describe('CrawlerOrchestrator.crawling: dedupeCap event handling (issue #208)', () => {
	it('dedupeCap → archive.insertDedupeCapEvent が呼ばれ、その id が crawlEnd での finalizeDedupeCapEvent に使われる', async () => {
		const insertDedupeCapEvent = vi.fn(() => Promise.resolve(99));
		const finalizeDedupeCapEvent = vi.fn(() => Promise.resolve());
		const accumulateDedupeCapRejectedCount = vi.fn(() => Promise.resolve());
		const fakeArchive = {
			on: vi.fn(),
			setConfig: vi.fn(() => Promise.resolve()),
			getConfig: vi.fn(() => Promise.resolve({ analyze: [] })),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			getResourceByUrl: vi.fn(() => Promise.resolve(null)),
			insertDedupeCapEvent,
			finalizeDedupeCapEvent,
			accumulateDedupeCapRejectedCount,
			filePath: '/tmp/orchestrator-dedupe-cap-test.nitpicker',
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'create').mockResolvedValueOnce(fakeArchive);

		fakeCrawlerDriver = (crawler) => {
			crawler.handlers.get('dedupeCap')?.({
				shapeKey: 'example.com/news/{n}/',
				sampleUrl: 'https://example.com/news/1/',
				bodyHash: Buffer.from('a'),
				effectiveThreshold: 1,
				observedCount: 2,
			} as never);
			(
				crawler as unknown as { getDedupeCapRejections: () => Map<string, number> }
			).getDedupeCapRejections = () => new Map([['example.com/news/{n}/', 5]]);
			crawler.handlers.get('crawlEnd')?.(undefined as never);
		};

		await CrawlerOrchestrator.crawling(['https://example.com/'], {
			cwd: '/tmp',
			filePath: '/tmp/orchestrator-dedupe-cap-test.nitpicker',
		});

		expect(insertDedupeCapEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				shapeKey: 'example.com/news/{n}/',
				sampleUrl: 'https://example.com/news/1/',
				effectiveThreshold: 1,
				observedCount: 2,
			}),
		);
		expect(finalizeDedupeCapEvent).toHaveBeenCalledWith(99, 5);
		expect(accumulateDedupeCapRejectedCount).not.toHaveBeenCalled();
	});

	it('このセッションでdedupeCapイベントが発火していないshape（プリロード済みsticky）の拒否数はaccumulateDedupeCapRejectedCountでshape_key照合により加算される', async () => {
		// A shape preloaded into DedupeCapTracker's sticky set from an earlier
		// session's `dedupe_cap_events` row never re-fires `dedupeCap` this
		// session (the tracker short-circuits before `observe` runs), so
		// `#dedupeCapEventIds` has no entry for it — yet gate rejections still
		// accumulate. Regression guard: this must not be silently dropped.
		const insertDedupeCapEvent = vi.fn(() => Promise.resolve(99));
		const finalizeDedupeCapEvent = vi.fn(() => Promise.resolve());
		const accumulateDedupeCapRejectedCount = vi.fn(() => Promise.resolve());
		const fakeArchive = {
			on: vi.fn(),
			setConfig: vi.fn(() => Promise.resolve()),
			getConfig: vi.fn(() => Promise.resolve({ analyze: [] })),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			getResourceByUrl: vi.fn(() => Promise.resolve(null)),
			insertDedupeCapEvent,
			finalizeDedupeCapEvent,
			accumulateDedupeCapRejectedCount,
			filePath: '/tmp/orchestrator-dedupe-cap-preloaded-test.nitpicker',
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'create').mockResolvedValueOnce(fakeArchive);

		fakeCrawlerDriver = (crawler) => {
			// No `dedupeCap` event fired this session — simulates a shape that
			// was already sticky from a prior session's preload.
			(
				crawler as unknown as { getDedupeCapRejections: () => Map<string, number> }
			).getDedupeCapRejections = () => new Map([['example.com/archived-trap/{n}/', 3]]);
			crawler.handlers.get('crawlEnd')?.(undefined as never);
		};

		await CrawlerOrchestrator.crawling(['https://example.com/'], {
			cwd: '/tmp',
			filePath: '/tmp/orchestrator-dedupe-cap-preloaded-test.nitpicker',
		});

		expect(insertDedupeCapEvent).not.toHaveBeenCalled();
		expect(finalizeDedupeCapEvent).not.toHaveBeenCalled();
		expect(accumulateDedupeCapRejectedCount).toHaveBeenCalledWith(
			'example.com/archived-trap/{n}/',
			3,
		);
	});

	it('拒否が一度も起きなかった（getDedupeCapRejectionsに現れない）今セッションcapped済みshapeもrejected_count=0でfinalizeされる（NULLのまま放置しない）', async () => {
		// A shape that caps near the very end of the crawl (or whose remaining
		// anchors were all already discovered before it capped) never enters
		// `getDedupeCapRejections()` — regression guard for a bug where such a
		// shape's row stayed `rejected_count: NULL` forever despite `crawlEnd`
		// firing normally, indistinguishable from "the crawl never completed".
		const insertDedupeCapEvent = vi.fn(() => Promise.resolve(99));
		const finalizeDedupeCapEvent = vi.fn(() => Promise.resolve());
		const accumulateDedupeCapRejectedCount = vi.fn(() => Promise.resolve());
		const fakeArchive = {
			on: vi.fn(),
			setConfig: vi.fn(() => Promise.resolve()),
			getConfig: vi.fn(() => Promise.resolve({ analyze: [] })),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			getResourceByUrl: vi.fn(() => Promise.resolve(null)),
			insertDedupeCapEvent,
			finalizeDedupeCapEvent,
			accumulateDedupeCapRejectedCount,
			filePath: '/tmp/orchestrator-dedupe-cap-zero-rejections-test.nitpicker',
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'create').mockResolvedValueOnce(fakeArchive);

		fakeCrawlerDriver = (crawler) => {
			crawler.handlers.get('dedupeCap')?.({
				shapeKey: 'example.com/late-cap/{n}/',
				sampleUrl: 'https://example.com/late-cap/1/',
				bodyHash: Buffer.from('a'),
				effectiveThreshold: 1,
				observedCount: 2,
			} as never);
			// No further rejections for this shape — the default FakeCrawler
			// stub already returns an empty Map, matching this scenario.
			crawler.handlers.get('crawlEnd')?.(undefined as never);
		};

		await CrawlerOrchestrator.crawling(['https://example.com/'], {
			cwd: '/tmp',
			filePath: '/tmp/orchestrator-dedupe-cap-zero-rejections-test.nitpicker',
		});

		expect(finalizeDedupeCapEvent).toHaveBeenCalledWith(99, 0);
		expect(accumulateDedupeCapRejectedCount).not.toHaveBeenCalled();
	});
});

describe('CrawlerOrchestrator.inventory: dedupeCap sticky preload wiring (issue #208)', () => {
	it('archive.listDedupeCapShapeKeys() の結果がCrawlerのpreloadedStickyShapeKeysオプションへ渡される', async () => {
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
			getScrapedHtmlPageCount: vi.fn(() => Promise.resolve(0)),
			listDnsBurnedHostCandidates: vi.fn(() => Promise.resolve([])),
			listDedupeCapShapeKeys: vi.fn(() =>
				Promise.resolve(['example.com/old-trap/{n}/', 'example.com/other-trap/{v}']),
			),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			close: vi.fn(() => Promise.resolve()),
			setResources: vi.fn(() => Promise.resolve()),
			insertInventorySeeds: vi.fn(() => Promise.resolve()),
			insertInventorySkippedPages: vi.fn(() => Promise.resolve()),
			insertInventoryResources: vi.fn(() => Promise.resolve()),
			addError: vi.fn(() => Promise.resolve()),
			recordInventoryRun: vi.fn(() => Promise.resolve(1)),
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		fakeCrawlerDriver = (crawler) => {
			crawler.handlers.get('crawlEnd')?.(undefined as never);
		};

		const testCwd = path.resolve('/tmp/inventory-dedupe-cap-preload-test');
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

		expect(fakeArchive.listDedupeCapShapeKeys).toHaveBeenCalledTimes(1);
		expect(fakeCrawlerConstructorCalls).toHaveLength(1);
		expect(fakeCrawlerConstructorCalls[0]).toMatchObject({
			preloadedStickyShapeKeys: [
				'example.com/old-trap/{n}/',
				'example.com/other-trap/{v}',
			],
		});
	});
});

describe('CrawlerOrchestrator.recrawl', () => {
	/**
	 * Builds the mocked Archive shared by the recrawl tests. Every write-side
	 * method is a spy so the tests can assert exactly what was reset /
	 * ingested / recorded.
	 * @param overrides - Per-test overrides layered on top of the defaults
	 *   (e.g. `getExistingPageUrls`, `resetPagesByUrls`).
	 * @returns The fake Archive instance.
	 */
	function buildFakeRecrawlArchive(overrides: Record<string, unknown> = {}) {
		return {
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
			saveInventorySourceList: vi.fn(() => Promise.resolve()),
			getExistingPageUrls: vi.fn(() => Promise.resolve([])),
			getExistingResourceUrls: vi.fn(() => Promise.resolve([])),
			resetPagesByUrls: vi.fn(() =>
				Promise.resolve({
					resetUrls: [],
					excludedRedirects: [],
					excludedSkipped: [],
					excludedExternal: [],
				}),
			),
			getResourceUrlList: vi.fn(() => Promise.resolve([])),
			getScrapedHtmlPageCount: vi.fn(() => Promise.resolve(0)),
			listDnsBurnedHostCandidates: vi.fn(() => Promise.resolve([])),
			listDedupeCapShapeKeys: vi.fn(() => Promise.resolve([])),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			close: vi.fn(() => Promise.resolve()),
			insertInventorySeeds: vi.fn(() => Promise.resolve()),
			insertInventorySkippedPages: vi.fn(() => Promise.resolve()),
			insertInventoryResources: vi.fn(() => Promise.resolve()),
			recordInventoryRun: vi.fn(() => Promise.resolve(1)),
			...overrides,
		} as unknown as Archive;
	}

	/**
	 * Creates an empty fixture `.nitpicker` file under a fresh temp cwd —
	 * `copyFileWithProgress`'s `.bak` copy and `unlinkFile` run against the
	 * real filesystem even though `Archive.open` itself is mocked.
	 * @param name
	 * @returns The temp cwd path; caller must `fs.rm(testCwd, { recursive: true, force: true })` afterward.
	 */
	async function makeFixtureCwd(name: string): Promise<string> {
		const testCwd = path.resolve(`/tmp/${name}`);
		await fs.mkdir(testCwd, { recursive: true });
		await fs.writeFile(path.join(testCwd, 'fixture.nitpicker'), '');
		return testCwd;
	}

	it('throws synchronously when recrawlUrls is empty (no file I/O attempted)', async () => {
		const archiveModule = await import('./archive/archive.js');
		const openSpy = vi.spyOn(archiveModule.default, 'open');

		await expect(
			CrawlerOrchestrator.recrawl('/does/not/exist.nitpicker', []),
		).rejects.toThrow('recrawl: URL list is empty');
		expect(openSpy).not.toHaveBeenCalled();
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
			CrawlerOrchestrator.recrawl('/tmp/anything.nitpicker', ['https://example.com/'], {
				cwd: '/tmp',
			}),
		).rejects.toThrow(
			'Cannot recrawl a list-mode archive: this archive was created with --list/--list-file and contains metadata-only pages. Create a fresh archive instead.',
		);
		expect(closeSpy).toHaveBeenCalledOnce();
	});

	it('archives the source list bytes when a source is given, before scope classification (mirrors inventory)', async () => {
		const fakeArchive = buildFakeRecrawlArchive({
			getExistingPageUrls: vi.fn(() => Promise.resolve(['https://example.com/a'])),
			resetPagesByUrls: vi.fn(() =>
				Promise.resolve({
					resetUrls: ['https://example.com/a'],
					excludedRedirects: [],
					excludedSkipped: [],
					excludedExternal: [],
				}),
			),
		});
		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		fakeCrawlerDriver = (crawler) => {
			crawler.handlers.get('crawlEnd')?.(undefined as never);
		};

		const testCwd = await makeFixtureCwd('recrawl-source-archiving-test');
		const bytes = Buffer.from('https://example.com/a\n');
		try {
			await CrawlerOrchestrator.recrawl(
				'fixture.nitpicker',
				['https://example.com/a'],
				{ cwd: testCwd },
				undefined,
				{ sha256: 'deadbeef', bytes, invalidLineCount: 0 },
			);
		} finally {
			await fs.rm(testCwd, { recursive: true, force: true });
		}

		expect(fakeArchive.saveInventorySourceList).toHaveBeenCalledExactlyOnceWith(
			'deadbeef',
			bytes,
		);
	});

	it('does not call saveInventorySourceList when no source was given', async () => {
		const fakeArchive = buildFakeRecrawlArchive();
		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		fakeCrawlerDriver = (crawler) => {
			crawler.handlers.get('crawlEnd')?.(undefined as never);
		};

		const testCwd = await makeFixtureCwd('recrawl-no-source-test');
		try {
			await CrawlerOrchestrator.recrawl(
				'fixture.nitpicker',
				['https://example.com/new.html'],
				{ cwd: testCwd },
			);
		} finally {
			await fs.rm(testCwd, { recursive: true, force: true });
		}

		expect(fakeArchive.saveInventorySourceList).not.toHaveBeenCalled();
	});

	it('takes no backup and calls neither resetPagesByUrls nor the ingestion writers when nothing matched and nothing is novel', async () => {
		// Every recrawl URL resolves to an already-known resource — so
		// `existingPageUrls` (reset candidates) and `novelUrls` (ingestion
		// candidates) are both empty. This must mirror `inventory`'s
		// zero-novel early return: no `.bak`, no writes, no crawl.
		const fakeArchive = buildFakeRecrawlArchive({
			getExistingResourceUrls: vi.fn(() =>
				Promise.resolve(['https://example.com/known.js']),
			),
		});
		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		const orchestrator = await CrawlerOrchestrator.recrawl(
			'fixture.nitpicker',
			['https://example.com/known.js'],
			{ cwd: '/tmp/recrawl-noop-test' },
		);

		expect(orchestrator).toBeDefined();
		expect(fakeArchive.resetPagesByUrls).not.toHaveBeenCalled();
		expect(fakeArchive.insertInventorySeeds).not.toHaveBeenCalled();
		expect(fakeArchive.insertInventoryResources).not.toHaveBeenCalled();
		expect(fakeArchive.recordInventoryRun).not.toHaveBeenCalled();
		expect(fakeCrawlerResumeCalls).toHaveLength(0);
	});

	it("merges resetPagesByUrls's resetUrls into the pending set handed to Crawler#resume, even when the strict-pending scan finds none (strict-pending gap)", async () => {
		// Simulates the scenario this method's JSDoc documents: two listed
		// pages referenced only each other, so resetting both wiped the only
		// anchor referrer of each — `getCrawlingState` (the strict scan)
		// legitimately returns an empty `pending` here. Without the explicit
		// merge, both reset pages would never be re-fetched.
		const fakeArchive = buildFakeRecrawlArchive({
			getExistingPageUrls: vi.fn(() =>
				Promise.resolve(['https://example.com/a', 'https://example.com/b']),
			),
			resetPagesByUrls: vi.fn(() =>
				Promise.resolve({
					resetUrls: ['https://example.com/a', 'https://example.com/b'],
					excludedRedirects: [],
					excludedSkipped: [],
					excludedExternal: [],
				}),
			),
		});
		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		fakeCrawlerDriver = (crawler) => {
			crawler.handlers.get('crawlEnd')?.(undefined as never);
		};

		const testCwd = await makeFixtureCwd('recrawl-pending-merge-test');
		try {
			await CrawlerOrchestrator.recrawl(
				'fixture.nitpicker',
				['https://example.com/a', 'https://example.com/b'],
				{ cwd: testCwd },
			);
		} finally {
			await fs.rm(testCwd, { recursive: true, force: true });
		}

		expect(fakeArchive.resetPagesByUrls).toHaveBeenCalledOnce();
		expect(vi.mocked(fakeArchive.resetPagesByUrls).mock.calls[0]![0]).toEqual([
			'https://example.com/a',
			'https://example.com/b',
		]);
		expect(fakeCrawlerResumeCalls).toHaveLength(1);
		expect(fakeCrawlerResumeCalls[0]?.pending.toSorted()).toEqual([
			'https://example.com/a',
			'https://example.com/b',
		]);
	});

	it('deduplicates reset URLs already present in the strict-pending scan instead of listing them twice', async () => {
		const fakeArchive = buildFakeRecrawlArchive({
			getExistingPageUrls: vi.fn(() => Promise.resolve(['https://example.com/a'])),
			getCrawlingState: vi.fn(() =>
				Promise.resolve({ scraped: [], pending: ['https://example.com/a'] }),
			),
			resetPagesByUrls: vi.fn(() =>
				Promise.resolve({
					resetUrls: ['https://example.com/a'],
					excludedRedirects: [],
					excludedSkipped: [],
					excludedExternal: [],
				}),
			),
		});
		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		fakeCrawlerDriver = (crawler) => {
			crawler.handlers.get('crawlEnd')?.(undefined as never);
		};

		const testCwd = await makeFixtureCwd('recrawl-pending-dedup-test');
		try {
			await CrawlerOrchestrator.recrawl('fixture.nitpicker', ['https://example.com/a'], {
				cwd: testCwd,
			});
		} finally {
			await fs.rm(testCwd, { recursive: true, force: true });
		}

		expect(fakeCrawlerResumeCalls).toHaveLength(1);
		expect(fakeCrawlerResumeCalls[0]?.pending).toEqual(['https://example.com/a']);
	});

	it('starts a crawl to re-fetch reset pages even when no novel HTML seed was ingested', async () => {
		// `htmlSeeds.length === 0` alone must not skip crawling — a
		// reset-only recrawl (every URL already existed) still needs the
		// dealer to actually re-fetch the reset pages.
		const fakeArchive = buildFakeRecrawlArchive({
			getExistingPageUrls: vi.fn(() => Promise.resolve(['https://example.com/a'])),
			resetPagesByUrls: vi.fn(() =>
				Promise.resolve({
					resetUrls: ['https://example.com/a'],
					excludedRedirects: [],
					excludedSkipped: [],
					excludedExternal: [],
				}),
			),
		});
		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		fakeCrawlerDriver = (crawler) => {
			crawler.handlers.get('crawlEnd')?.(undefined as never);
		};

		const testCwd = await makeFixtureCwd('recrawl-reset-only-test');
		try {
			await CrawlerOrchestrator.recrawl('fixture.nitpicker', ['https://example.com/a'], {
				cwd: testCwd,
			});
		} finally {
			await fs.rm(testCwd, { recursive: true, force: true });
		}

		expect(fakeCrawlerResumeCalls).toHaveLength(1);
		expect(fakeArchive.insertInventorySeeds).toHaveBeenCalledWith([]);
	});

	it('warns (via setupProgress.onLog) about URLs matched as existing resources without resetting them', async () => {
		const fakeArchive = buildFakeRecrawlArchive({
			getExistingResourceUrls: vi.fn(() =>
				Promise.resolve(['https://example.com/known.js']),
			),
		});
		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		fakeCrawlerDriver = (crawler) => {
			crawler.handlers.get('crawlEnd')?.(undefined as never);
		};

		const testCwd = await makeFixtureCwd('recrawl-resource-warning-test');
		const onLog = vi.fn();
		try {
			await CrawlerOrchestrator.recrawl(
				'fixture.nitpicker',
				// One matched resource (not reset) + one genuinely novel HTML
				// URL, so the run proceeds past the resource-only early return.
				['https://example.com/known.js', 'https://example.com/new.html'],
				{ cwd: testCwd },
				undefined,
				null,
				{ onLog },
			);
		} finally {
			await fs.rm(testCwd, { recursive: true, force: true });
		}

		expect(onLog).toHaveBeenCalledWith(
			expect.stringMatching(/1 URL\(s\) matched existing resources/),
		);
		expect(vi.mocked(fakeArchive.resetPagesByUrls).mock.calls[0]![0]).toEqual([]);
	});

	it('reports the reset/excluded breakdown via setupProgress.onLog after resetPagesByUrls resolves', async () => {
		const fakeArchive = buildFakeRecrawlArchive({
			getExistingPageUrls: vi.fn(() =>
				Promise.resolve([
					'https://example.com/reset-me',
					'https://example.com/redirect-source',
					'https://example.com/skipped',
					'https://external.example/page',
				]),
			),
			resetPagesByUrls: vi.fn(() =>
				Promise.resolve({
					resetUrls: ['https://example.com/reset-me'],
					excludedRedirects: ['https://example.com/redirect-source'],
					excludedSkipped: ['https://example.com/skipped'],
					excludedExternal: ['https://external.example/page'],
				}),
			),
		});
		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		fakeCrawlerDriver = (crawler) => {
			crawler.handlers.get('crawlEnd')?.(undefined as never);
		};

		const testCwd = await makeFixtureCwd('recrawl-summary-log-test');
		const onLog = vi.fn();
		try {
			await CrawlerOrchestrator.recrawl(
				'fixture.nitpicker',
				[
					'https://example.com/reset-me',
					'https://example.com/redirect-source',
					'https://example.com/skipped',
					'https://external.example/page',
				],
				{ cwd: testCwd },
				undefined,
				null,
				{ onLog },
			);
		} finally {
			await fs.rm(testCwd, { recursive: true, force: true });
		}

		expect(onLog).toHaveBeenCalledWith(
			expect.stringMatching(
				/matched 4 existing page\(s\) — reset 1, excluded 3 \(1 redirect source\(s\), 1 intentionally-skipped, 1 external\), already pending 0\./,
			),
		);
	});

	it('names the "already pending" remainder when a matched URL is still scraped=0 from an interrupted previous session', async () => {
		// `existingPageUrls` matches by URL alone (see
		// `getExistingPageUrls`), so it can include a row still pending from
		// an earlier interrupted session — `resetPagesByUrls` correctly
		// leaves such a row out of every one of its result arrays (nothing to
		// reset), but the summary log must still account for it by name or
		// "matched N" and "reset + excluded" silently stop summing to N.
		const fakeArchive = buildFakeRecrawlArchive({
			getExistingPageUrls: vi.fn(() =>
				Promise.resolve(['https://example.com/reset-me', 'https://example.com/pending']),
			),
			resetPagesByUrls: vi.fn(() =>
				Promise.resolve({
					resetUrls: ['https://example.com/reset-me'],
					excludedRedirects: [],
					excludedSkipped: [],
					excludedExternal: [],
				}),
			),
		});
		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		fakeCrawlerDriver = (crawler) => {
			crawler.handlers.get('crawlEnd')?.(undefined as never);
		};

		const testCwd = await makeFixtureCwd('recrawl-already-pending-test');
		const onLog = vi.fn();
		try {
			await CrawlerOrchestrator.recrawl(
				'fixture.nitpicker',
				['https://example.com/reset-me', 'https://example.com/pending'],
				{ cwd: testCwd },
				undefined,
				null,
				{ onLog },
			);
		} finally {
			await fs.rm(testCwd, { recursive: true, force: true });
		}

		expect(onLog).toHaveBeenCalledWith(
			expect.stringMatching(
				/matched 2 existing page\(s\) — reset 1, excluded 0 \(0 redirect source\(s\), 0 intentionally-skipped, 0 external\), already pending 1\./,
			),
		);
	});

	it('writes the audit row with the recrawl list-label prefix and a notes column recording the reset count', async () => {
		const fakeArchive = buildFakeRecrawlArchive({
			getExistingPageUrls: vi.fn(() => Promise.resolve(['https://example.com/a'])),
			resetPagesByUrls: vi.fn(() =>
				Promise.resolve({
					resetUrls: ['https://example.com/a'],
					excludedRedirects: [],
					excludedSkipped: [],
					excludedExternal: [],
				}),
			),
		});
		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		fakeCrawlerDriver = (crawler) => {
			crawler.handlers.get('crawlEnd')?.(undefined as never);
		};

		const testCwd = await makeFixtureCwd('recrawl-audit-row-test');
		try {
			await CrawlerOrchestrator.recrawl('fixture.nitpicker', ['https://example.com/a'], {
				cwd: testCwd,
			});
		} finally {
			await fs.rm(testCwd, { recursive: true, force: true });
		}

		const recordInventoryRunMock = vi.mocked(fakeArchive.recordInventoryRun);
		expect(recordInventoryRunMock).toHaveBeenCalledTimes(1);
		const [meta] = recordInventoryRunMock.mock.calls[0]!;
		expect(meta.list_label).toMatch(/^recrawl-/);
		expect(meta.notes).toBe('Reset 1 existing page(s) for re-fetch');
	});

	it('emits a crawlSessionNotice recommending an analyze re-run when at least one page was reset', async () => {
		const fakeArchive = buildFakeRecrawlArchive({
			getExistingPageUrls: vi.fn(() => Promise.resolve(['https://example.com/a'])),
			resetPagesByUrls: vi.fn(() =>
				Promise.resolve({
					resetUrls: ['https://example.com/a'],
					excludedRedirects: [],
					excludedSkipped: [],
					excludedExternal: [],
				}),
			),
		});
		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		fakeCrawlerDriver = (crawler) => {
			crawler.handlers.get('crawlEnd')?.(undefined as never);
		};

		const notices: string[] = [];
		const testCwd = await makeFixtureCwd('recrawl-analyze-notice-test');
		try {
			await CrawlerOrchestrator.recrawl(
				'fixture.nitpicker',
				['https://example.com/a'],
				{ cwd: testCwd },
				(orchestrator) => {
					orchestrator.on('crawlSessionNotice', (payload) => {
						notices.push((payload as { message: string }).message);
					});
				},
			);
		} finally {
			await fs.rm(testCwd, { recursive: true, force: true });
		}

		expect(notices).toEqual([
			expect.stringMatching(/Reset 1 page\(s\).*run `analyze` before `report`/),
		]);
	});

	it('does not emit a crawlSessionNotice when nothing was reset', async () => {
		const fakeArchive = buildFakeRecrawlArchive();
		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		fakeCrawlerDriver = (crawler) => {
			crawler.handlers.get('crawlEnd')?.(undefined as never);
		};

		const notices: string[] = [];
		const testCwd = await makeFixtureCwd('recrawl-no-notice-test');
		try {
			await CrawlerOrchestrator.recrawl(
				'fixture.nitpicker',
				['https://example.com/new.html'],
				{ cwd: testCwd },
				(orchestrator) => {
					orchestrator.on('crawlSessionNotice', (payload) => {
						notices.push((payload as { message: string }).message);
					});
				},
			);
		} finally {
			await fs.rm(testCwd, { recursive: true, force: true });
		}

		expect(notices).toEqual([]);
	});
});

describe('CrawlerOrchestrator: openPluginData regression guard (issue #99)', () => {
	// `Archive.open`'s default extracts only `db.sqlite`; `write()` re-tars
	// the whole tmpDir, so any writer path that skips `openPluginData: true`
	// would silently drop non-`db.sqlite` tar entries (analyze output, a
	// saved inventory list) on the next re-crawl. `append`'s equivalent
	// assertions live in its own describe block above; these two round out
	// the other writer paths that call `write()`.

	it('CrawlerOrchestrator.inventory opens the archive with openPluginData: true', async () => {
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
			CrawlerOrchestrator.inventory('./existing.nitpicker', ['https://example.com/'], {
				cwd: '/tmp/test-cwd',
			}),
		).rejects.toThrow('stop-here');

		expect(openSpy).toHaveBeenCalledOnce();
		const openArg = openSpy.mock.calls[0]![0] as { openPluginData?: boolean };
		expect(openArg.openPluginData).toBe(true);
	});

	it('CrawlerOrchestrator.retryFailed opens the archive with openPluginData: true', async () => {
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
			CrawlerOrchestrator.retryFailed('./existing.nitpicker', {
				cwd: '/tmp/test-cwd',
			}),
		).rejects.toThrow('stop-here');

		expect(openSpy).toHaveBeenCalledOnce();
		const openArg = openSpy.mock.calls[0]![0] as { openPluginData?: boolean };
		expect(openArg.openPluginData).toBe(true);
	});

	it('CrawlerOrchestrator.recrawl opens the archive with openPluginData: true', async () => {
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
			CrawlerOrchestrator.recrawl('./existing.nitpicker', ['https://example.com/'], {
				cwd: '/tmp/test-cwd',
			}),
		).rejects.toThrow('stop-here');

		expect(openSpy).toHaveBeenCalledOnce();
		const openArg = openSpy.mock.calls[0]![0] as { openPluginData?: boolean };
		expect(openArg.openPluginData).toBe(true);
	});
});

describe('CrawlerOrchestrator.inventory: source list archiving (issue #99)', () => {
	/**
	 * Builds a fake archive stubbed for the no-op early-return path (every
	 * candidate URL already known → `novelUrls.length === 0`), with
	 * `saveInventorySourceList` spied so tests can assert whether/how it
	 * was called.
	 * @returns The fake archive and its `saveInventorySourceList` spy.
	 */
	function setupNoopFakeArchive() {
		const saveInventorySourceList = vi.fn(() => Promise.resolve());
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
			saveInventorySourceList,
		} as unknown as Archive;
		return { fakeArchive, saveInventorySourceList };
	}

	it('archives the exact source bytes even when every URL resolves to the no-op early return', async () => {
		// The no-op early return (`novelUrls.length === 0`) skips the `.bak`
		// window and the audit-row write entirely — but a run that discarded
		// every URL (all already known, or all out of scope) is exactly the
		// case an operator most needs a recoverable copy of what was fed in.
		// `saveInventorySourceList` must run before that early return, not
		// only on the ingestion happy path.
		const { fakeArchive, saveInventorySourceList } = setupNoopFakeArchive();
		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		const bytes = Buffer.from('https://example.com/already-known\n');
		await CrawlerOrchestrator.inventory(
			'fixture.nitpicker',
			['https://example.com/already-known'],
			{ cwd: '/tmp/inventory-source-archive-noop-test' },
			undefined,
			{ sha256: 'deadbeef', bytes, invalidLineCount: 0 },
		);

		expect(saveInventorySourceList).toHaveBeenCalledExactlyOnceWith('deadbeef', bytes);
	});

	it('does not call saveInventorySourceList when no source was given', async () => {
		// Programmatic callers that built `inventoryUrls` in-memory (no
		// backing file) pass `source: null` — there is nothing to archive.
		const { fakeArchive, saveInventorySourceList } = setupNoopFakeArchive();
		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		await CrawlerOrchestrator.inventory(
			'fixture.nitpicker',
			['https://example.com/already-known'],
			{ cwd: '/tmp/inventory-source-archive-null-test' },
		);

		expect(saveInventorySourceList).not.toHaveBeenCalled();
	});

	it("records the audit row's source_file_sha256 as NULL when no source was given", async () => {
		const saveInventorySourceList = vi.fn(() => Promise.resolve());
		const recordInventoryRun = vi.fn(() => Promise.resolve(1));
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
			insertInventorySkippedPages: vi.fn(() => Promise.resolve()),
			insertInventoryResources: vi.fn(() => Promise.resolve()),
			addError: vi.fn(() => Promise.resolve()),
			recordInventoryRun,
			saveInventorySourceList,
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		const testCwd = path.resolve('/tmp/inventory-source-sha-null-test');
		await fs.mkdir(testCwd, { recursive: true });
		const fixturePath = path.join(testCwd, 'fixture.nitpicker');
		await fs.writeFile(fixturePath, '');

		try {
			await CrawlerOrchestrator.inventory(
				'fixture.nitpicker',
				['https://example.com/orphan.pdf'],
				{ cwd: testCwd },
			);
		} finally {
			await fs.rm(testCwd, { recursive: true, force: true });
		}

		expect(saveInventorySourceList).not.toHaveBeenCalled();
		const [meta] = recordInventoryRun.mock.calls[0]!;
		expect(meta.source_file_sha256).toBeNull();
		expect(meta.total_lines).toBe(1);
	});

	it("records the audit row's invalid_skipped from source.invalidLineCount (issue #99)", async () => {
		const saveInventorySourceList = vi.fn(() => Promise.resolve());
		const recordInventoryRun = vi.fn(() => Promise.resolve(1));
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
			insertInventorySkippedPages: vi.fn(() => Promise.resolve()),
			insertInventoryResources: vi.fn(() => Promise.resolve()),
			addError: vi.fn(() => Promise.resolve()),
			recordInventoryRun,
			saveInventorySourceList,
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'open').mockResolvedValueOnce(fakeArchive);

		const testCwd = path.resolve('/tmp/inventory-invalid-skipped-test');
		await fs.mkdir(testCwd, { recursive: true });
		const fixturePath = path.join(testCwd, 'fixture.nitpicker');
		await fs.writeFile(fixturePath, '');

		try {
			await CrawlerOrchestrator.inventory(
				'fixture.nitpicker',
				['https://example.com/orphan.pdf'],
				{ cwd: testCwd },
				undefined,
				{ sha256: 'cafef00d', bytes: Buffer.from('x'), invalidLineCount: 12 },
			);
		} finally {
			await fs.rm(testCwd, { recursive: true, force: true });
		}

		const [meta] = recordInventoryRun.mock.calls[0]!;
		expect(meta.invalid_skipped).toBe(12);
	});
});

describe('CrawlerOrchestrator.write', () => {
	it("relays Archive.write()'s onStep/onTarProgress as writeStep/writeTarProgress events (issue #294)", async () => {
		const fakeWrite = vi.fn(
			(options?: {
				onStep?: (step: 'checkpoint' | 'rename' | 'tar' | 'remove') => void;
				onTarProgress?: (writtenBytes: number, totalBytes: number) => void;
			}) => {
				options?.onStep?.('checkpoint');
				options?.onTarProgress?.(50, 100);
				options?.onStep?.('remove');
				return Promise.resolve();
			},
		);
		const fakeArchive = {
			on: vi.fn(),
			setConfig: vi.fn(() => Promise.resolve()),
			getConfig: vi.fn(() => Promise.resolve({ analyze: [] })),
			addError: vi.fn(() => Promise.resolve()),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			getResourceByUrl: vi.fn(() => Promise.resolve(null)),
			filePath: '/tmp/orchestrator-write-test.nitpicker',
			write: fakeWrite,
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'create').mockResolvedValueOnce(fakeArchive);

		const stepEvents: string[] = [];
		const progressEvents: [number, number][] = [];

		const orchestrator = await CrawlerOrchestrator.crawling(
			['https://example.com/'],
			{ cwd: '/tmp', filePath: '/tmp/orchestrator-write-test.nitpicker' },
			(o) => {
				o.on('error', () => {});
				o.on('writeStep', ({ step }) => stepEvents.push(step));
				o.on('writeTarProgress', ({ writtenBytes, totalBytes }) => {
					progressEvents.push([writtenBytes, totalBytes]);
				});
			},
		);

		await orchestrator.write();

		expect(fakeWrite).toHaveBeenCalledWith({
			onStep: expect.any(Function),
			onTarProgress: expect.any(Function),
		});
		expect(stepEvents).toEqual(['checkpoint', 'remove']);
		expect(progressEvents).toEqual([[50, 100]]);
	});
});

describe('CrawlerOrchestrator[Symbol.asyncDispose]: recovery-write progress (issue #294)', () => {
	it("relays Archive.close()'s onRecoveryStart/onStep/onTarProgress as recoveringArchiveWrite/writeStep/writeTarProgress events", async () => {
		const fakeClose = vi.fn(
			(options?: {
				onRecoveryStart?: () => void;
				onStep?: (step: 'checkpoint' | 'rename' | 'tar' | 'remove') => void;
				onTarProgress?: (writtenBytes: number, totalBytes: number) => void;
			}) => {
				options?.onRecoveryStart?.();
				options?.onStep?.('checkpoint');
				options?.onTarProgress?.(50, 100);
				options?.onStep?.('remove');
				return Promise.resolve();
			},
		);
		const fakeArchive = {
			on: vi.fn(),
			setConfig: vi.fn(() => Promise.resolve()),
			getConfig: vi.fn(() => Promise.resolve({ analyze: [] })),
			addError: vi.fn(() => Promise.resolve()),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			getResourceByUrl: vi.fn(() => Promise.resolve(null)),
			filePath: '/tmp/orchestrator-dispose-test.nitpicker',
			write: vi.fn(() => Promise.resolve()),
			close: fakeClose,
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'create').mockResolvedValueOnce(fakeArchive);

		const recoveryEvents: number[] = [];
		const stepEvents: string[] = [];
		const progressEvents: [number, number][] = [];

		const orchestrator = await CrawlerOrchestrator.crawling(
			['https://example.com/'],
			{ cwd: '/tmp', filePath: '/tmp/orchestrator-dispose-test.nitpicker' },
			(o) => {
				o.on('error', () => {});
				o.on('recoveringArchiveWrite', () => recoveryEvents.push(1));
				o.on('writeStep', ({ step }) => stepEvents.push(step));
				o.on('writeTarProgress', ({ writtenBytes, totalBytes }) => {
					progressEvents.push([writtenBytes, totalBytes]);
				});
			},
		);

		await orchestrator[Symbol.asyncDispose]();

		expect(fakeClose).toHaveBeenCalledWith({
			onRecoveryStart: expect.any(Function),
			onStep: expect.any(Function),
			onTarProgress: expect.any(Function),
		});
		expect(recoveryEvents).toEqual([1]);
		expect(stepEvents).toEqual(['checkpoint', 'remove']);
		expect(progressEvents).toEqual([[50, 100]]);
	});

	it('does not emit recovery events when Archive.close() takes the no-op branch (already written)', async () => {
		const fakeArchive = {
			on: vi.fn(),
			setConfig: vi.fn(() => Promise.resolve()),
			getConfig: vi.fn(() => Promise.resolve({ analyze: [] })),
			addError: vi.fn(() => Promise.resolve()),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			getResourceByUrl: vi.fn(() => Promise.resolve(null)),
			filePath: '/tmp/orchestrator-dispose-no-recovery-test.nitpicker',
			write: vi.fn(() => Promise.resolve()),
			close: vi.fn(() => Promise.resolve()),
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'create').mockResolvedValueOnce(fakeArchive);

		const recoveryEvents: number[] = [];

		const orchestrator = await CrawlerOrchestrator.crawling(
			['https://example.com/'],
			{ cwd: '/tmp', filePath: '/tmp/orchestrator-dispose-no-recovery-test.nitpicker' },
			(o) => {
				o.on('error', () => {});
				o.on('recoveringArchiveWrite', () => recoveryEvents.push(1));
			},
		);

		await orchestrator[Symbol.asyncDispose]();

		expect(recoveryEvents).toEqual([]);
	});
});

describe('CrawlerOrchestrator.crawling: setUrlOrder progress', () => {
	it("relays Archive.setUrlOrder()'s chunk progress as sortingUrls events (issue #294)", async () => {
		const fakeSetUrlOrder = vi.fn(
			(onProgress?: (processed: number, total: number) => void) => {
				onProgress?.(500, 1200);
				onProgress?.(1200, 1200);
				return Promise.resolve();
			},
		);
		const fakeArchive = {
			on: vi.fn(),
			setConfig: vi.fn(() => Promise.resolve()),
			getConfig: vi.fn(() => Promise.resolve({ analyze: [] })),
			addError: vi.fn(() => Promise.resolve()),
			setUrlOrder: fakeSetUrlOrder,
			getResourceByUrl: vi.fn(() => Promise.resolve(null)),
			filePath: '/tmp/orchestrator-sorting-test.nitpicker',
			write: vi.fn(() => Promise.resolve()),
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'create').mockResolvedValueOnce(fakeArchive);

		const progressEvents: [number, number][] = [];

		await CrawlerOrchestrator.crawling(
			['https://example.com/'],
			{ cwd: '/tmp', filePath: '/tmp/orchestrator-sorting-test.nitpicker' },
			(o) => {
				o.on('error', () => {});
				o.on('sortingUrls', ({ processed, total }) => {
					progressEvents.push([processed, total]);
				});
			},
		);

		expect(fakeSetUrlOrder).toHaveBeenCalledWith(expect.any(Function));
		expect(progressEvents).toEqual([
			[500, 1200],
			[1200, 1200],
		]);
	});
});

describe('CrawlerOrchestrator.crawling: flushingPendingWrites (issue #294)', () => {
	it('emits flushingPendingWrites with the pending count when crawlEnd fires while a write is still queued', async () => {
		const fakeArchive = {
			on: vi.fn(),
			setConfig: vi.fn(() => Promise.resolve()),
			getConfig: vi.fn(() => Promise.resolve({ analyze: [] })),
			// The default FakeCrawler driver emits one `error` then
			// `crawlEnd` synchronously — `addError` is enqueued onto the
			// orchestrator's WriteQueue but its promise has no chance to
			// settle before crawlEnd's handler reads `writeQueue.pending`.
			addError: vi.fn(() => Promise.resolve()),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			getResourceByUrl: vi.fn(() => Promise.resolve(null)),
			filePath: '/tmp/orchestrator-flush-test.nitpicker',
			write: vi.fn(() => Promise.resolve()),
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'create').mockResolvedValueOnce(fakeArchive);

		const flushEvents: number[] = [];

		await CrawlerOrchestrator.crawling(
			['https://example.com/'],
			{ cwd: '/tmp', filePath: '/tmp/orchestrator-flush-test.nitpicker' },
			(o) => {
				o.on('error', () => {});
				o.on('flushingPendingWrites', ({ pending }) => {
					flushEvents.push(pending);
				});
			},
		);

		expect(flushEvents).toEqual([1]);
	});

	it('does not emit flushingPendingWrites when the queue is already empty at crawlEnd', async () => {
		const fakeArchive = {
			on: vi.fn(),
			setConfig: vi.fn(() => Promise.resolve()),
			getConfig: vi.fn(() => Promise.resolve({ analyze: [] })),
			addError: vi.fn(() => Promise.resolve()),
			setUrlOrder: vi.fn(() => Promise.resolve()),
			getResourceByUrl: vi.fn(() => Promise.resolve(null)),
			filePath: '/tmp/orchestrator-no-flush-test.nitpicker',
			write: vi.fn(() => Promise.resolve()),
		} as unknown as Archive;

		const archiveModule = await import('./archive/archive.js');
		vi.spyOn(archiveModule.default, 'create').mockResolvedValueOnce(fakeArchive);

		const flushEvents: number[] = [];
		fakeCrawlerDriver = (crawler) => {
			// No `error` this time — nothing is ever enqueued onto the
			// WriteQueue before `crawlEnd` fires.
			crawler.handlers.get('crawlEnd')?.(undefined as never);
		};

		await CrawlerOrchestrator.crawling(
			['https://example.com/'],
			{ cwd: '/tmp', filePath: '/tmp/orchestrator-no-flush-test.nitpicker' },
			(o) => {
				o.on('error', () => {});
				o.on('flushingPendingWrites', ({ pending }) => {
					flushEvents.push(pending);
				});
			},
		);

		expect(flushEvents).toEqual([]);
	});
});
