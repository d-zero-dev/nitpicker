import type { CrawlerEventTypes } from './types.js';
import type { ExURL } from '@d-zero/shared/parse-url';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@d-zero/dealer', () => ({
	deal: vi.fn(),
}));

vi.mock('@d-zero/shared/retry', () => ({
	/**
	 * Stub retryCall that honours the `retries` option, runs the function up
	 * to `retries + 1` times on failure, and invokes `onWait` between attempts
	 * and `onGiveUp` after the last failure. Real interval delays are skipped
	 * (zero wait) so tests don't pay actual back-off seconds per retry.
	 * @param fn - The function to call.
	 * @param opts - Retry options.
	 * @param opts.retries
	 * @param opts.label
	 * @param opts.onWait
	 * @param opts.onGiveUp
	 * @returns The result of calling fn.
	 */
	retryCall: async <T>(
		fn: () => Promise<T> | T,
		opts?: {
			retries?: number;
			label?: string;
			onWait?: (
				determinedInterval: number,
				retryCount: number,
				label?: string,
				error?: Error,
			) => void;
			onGiveUp?: (retryCount: number, error: Error, label?: string) => void;
		},
	): Promise<T> => {
		const maxRetries = opts?.retries ?? 0;
		let lastError: Error | undefined;
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				return await fn();
			} catch (rawError: unknown) {
				lastError = rawError instanceof Error ? rawError : new Error(String(rawError));
				if (attempt < maxRetries) {
					opts?.onWait?.(0, attempt, opts.label, lastError);
				}
			}
		}
		// Loop must have run at least once and captured an error before this
		// line is reachable; the `?? new Error(...)` is purely defensive so a
		// malformed `retries: -1` could not crash the stub.
		const finalError = lastError ?? new Error('retryCall stub: no error captured');
		opts?.onGiveUp?.(maxRetries, finalError, opts?.label);
		throw finalError;
	},
}));

vi.mock('./robots-checker.js', () => {
	/**
	 * Stub RobotsChecker that always allows crawling.
	 */
	class RobotsCheckerStub {
		/**
		 * Always returns true.
		 * @returns Resolved with true.
		 */
		isAllowed() {
			return Promise.resolve(true);
		}
	}
	return { RobotsChecker: RobotsCheckerStub };
});

/**
 * Configure the mocked deal() to synchronously drive every queued URL
 * through the crawler's worker callback, mirroring the dealer contract.
 *
 * The `push` / `unshift` queue callbacks handed to the factory are shared spies
 * (one pair per crawl, as the real dealer binds them to a single queue) so tests
 * can assert how newly-discovered URLs are routed (HTML → front, asset → tail).
 * URLs added via the spies are not re-fed into the loop — the mock only drives
 * the initial `items`, which is sufficient to observe the routing decision.
 * @returns The shared `push` and `unshift` spies passed to the worker factory.
 */
async function driveDeal() {
	const push = vi.fn(async () => {});
	const unshift = vi.fn(async () => {});
	const { deal } = await import('@d-zero/dealer');
	vi.mocked(deal).mockImplementation(async (items, factory) => {
		for (const [index, item] of (items as unknown[]).entries()) {
			const noop = () => {};
			// factory signature: (process, update, index, setLineHeader, push, unshift)
			// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- deal factory signature is complex; cast is intentional in test
			const workFn = (factory as Function)(item, noop, index, noop, push, unshift) as
				| (() => Promise<void>)
				| undefined;
			if (workFn) {
				await workFn();
			}
		}
	});
	return { push, unshift };
}

/**
 * Variant of {@link driveDeal} whose `push`/`unshift` spies feed newly
 * discovered URLs (e.g. predicted pagination batches) back into the same
 * queue instead of merely recording the call, draining until empty. Needed
 * for scenarios where a later assertion depends on a URL discovered
 * mid-crawl actually being scraped (`fetchDestination` called again for
 * it) — `driveDeal`'s single pass over the initial `items` never reaches
 * such URLs.
 *
 * Deduplicates by `withoutHashAndAuth` before dealing, mirroring the real
 * `@d-zero/dealer`'s `seen`-set contract (each URL is processed at most
 * once per crawl) — without this, a page whose anchors are re-fetched with
 * the SAME anchor list every time (as a test fixture's `mockImplementation`
 * naturally does, since it keys off the requested URL rather than crawl
 * progress) would have those anchors re-enqueued and re-dealt forever.
 * @returns The shared `push` and `unshift` spies passed to the worker factory.
 */
async function driveDealRecursive() {
	const push = vi.fn((...urls: unknown[]) => {
		pending.push(...urls);
		return Promise.resolve();
	});
	const unshift = vi.fn((...urls: unknown[]) => {
		pending.unshift(...urls);
		return Promise.resolve();
	});
	let pending: unknown[] = [];
	const seen = new Set<string>();
	const { deal } = await import('@d-zero/dealer');
	vi.mocked(deal).mockImplementation(async (items, factory) => {
		pending = [...(items as unknown[])];
		while (pending.length > 0) {
			const item = pending.shift();
			const key = (item as ExURL).withoutHashAndAuth;
			if (seen.has(key)) continue;
			seen.add(key);
			const noop = () => {};
			// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- deal factory signature is complex; cast is intentional in test
			const workFn = (factory as Function)(item, noop, 0, noop, push, unshift) as
				| (() => Promise<void>)
				| undefined;
			if (workFn) {
				await workFn();
			}
		}
	});
	return { push, unshift };
}

/**
 * Default crawler options for testing.
 */
const defaultOptions = {
	interval: 0,
	parallels: 1,
	recursive: true,
	roots: ['https://example.com/'],
	excludes: [],
	excludeKeywords: [],
	excludeUrls: [],
	ignoreRobots: true,
};

describe('Crawler', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	describe('#emitDealErrors via start()', () => {
		it('AggregateError の各エラーが個別の error イベントとして emit される', async () => {
			const { deal } = await import('@d-zero/dealer');
			const { default: Crawler } = await import('./crawler.js');

			vi.mocked(deal).mockRejectedValue(
				new AggregateError(
					[new Error('worker-1 failed'), new Error('worker-2 failed')],
					'deal failed',
				),
			);

			const crawler = new Crawler(defaultOptions);
			const errors: CrawlerEventTypes['error'][] = [];
			crawler.on('error', (e) => {
				errors.push(e);
			});

			const url = parseUrl('https://example.com/')!;
			crawler.start([url]);

			// deal() rejection triggers async .catch — wait for microtask queue
			await vi.waitFor(() => {
				expect(errors).toHaveLength(2);
			});

			expect(errors[0]!.error.message).toBe('worker-1 failed');
			expect(errors[1]!.error.message).toBe('worker-2 failed');
			expect(errors[0]!.url).toBe('https://example.com');
			expect(errors[0]!.isExternal).toBe(false);
			expect(errors[0]!.isMainProcess).toBe(true);
		});

		it('AggregateError 内の非 Error 値が Error に変換される', async () => {
			const { deal } = await import('@d-zero/dealer');
			const { default: Crawler } = await import('./crawler.js');

			vi.mocked(deal).mockRejectedValue(
				new AggregateError(['string error', 42], 'mixed errors'),
			);

			const crawler = new Crawler(defaultOptions);
			const errors: CrawlerEventTypes['error'][] = [];
			crawler.on('error', (e) => {
				errors.push(e);
			});

			crawler.start([parseUrl('https://example.com/')!]);

			await vi.waitFor(() => {
				expect(errors).toHaveLength(2);
			});

			expect(errors[0]!.error).toBeInstanceOf(Error);
			expect(errors[0]!.error.message).toBe('string error');
			expect(errors[1]!.error).toBeInstanceOf(Error);
			expect(errors[1]!.error.message).toBe('42');
		});

		it('通常の Error は単一の error イベントとして emit される', async () => {
			const { deal } = await import('@d-zero/dealer');
			const { default: Crawler } = await import('./crawler.js');

			vi.mocked(deal).mockRejectedValue(new Error('deal failed'));

			const crawler = new Crawler(defaultOptions);
			const errors: CrawlerEventTypes['error'][] = [];
			crawler.on('error', (e) => {
				errors.push(e);
			});

			crawler.start([parseUrl('https://example.com/')!]);

			await vi.waitFor(() => {
				expect(errors).toHaveLength(1);
			});

			expect(errors[0]!.error.message).toBe('deal failed');
		});

		it('deal 失敗後に crawlEnd イベントが emit される', async () => {
			const { deal } = await import('@d-zero/dealer');
			const { default: Crawler } = await import('./crawler.js');

			vi.mocked(deal).mockRejectedValue(new Error('fatal'));

			const crawler = new Crawler(defaultOptions);
			let crawlEndEmitted = false;
			crawler.on('crawlEnd', () => {
				crawlEndEmitted = true;
			});

			crawler.start([parseUrl('https://example.com/')!]);

			await vi.waitFor(() => {
				expect(crawlEndEmitted).toBe(true);
			});
		});
	});

	describe('#emitDealErrors via startMultiple()', () => {
		it('AggregateError の各エラーが個別に emit される', async () => {
			const { deal } = await import('@d-zero/dealer');
			const { default: Crawler } = await import('./crawler.js');

			vi.mocked(deal).mockRejectedValue(
				new AggregateError(
					[new Error('err-a'), new Error('err-b'), new Error('err-c')],
					'deal failed',
				),
			);

			const crawler = new Crawler(defaultOptions);
			const errors: CrawlerEventTypes['error'][] = [];
			crawler.on('error', (e) => {
				errors.push(e);
			});

			const urls = [
				parseUrl('https://example.com/page1')!,
				parseUrl('https://example.com/page2')!,
			];
			crawler.start(urls, { recursive: false });

			await vi.waitFor(() => {
				expect(errors).toHaveLength(3);
			});

			expect(errors[0]!.url).toBe('https://example.com/page1');
			expect(errors[0]!.error.message).toBe('err-a');
			expect(errors[1]!.error.message).toBe('err-b');
			expect(errors[2]!.error.message).toBe('err-c');
		});
	});

	describe('abort()', () => {
		it('abort() 後に deal() の signal オプションに渡された AbortSignal が aborted になる', async () => {
			const { deal } = await import('@d-zero/dealer');
			const { default: Crawler } = await import('./crawler.js');

			let receivedSignal: AbortSignal | undefined;

			vi.mocked(deal).mockImplementation((_items, _factory, options) => {
				receivedSignal = options?.signal;
				return Promise.resolve();
			});

			const crawler = new Crawler(defaultOptions);
			crawler.start([parseUrl('https://example.com/')!]);

			await vi.waitFor(() => {
				expect(receivedSignal).toBeDefined();
			});

			expect(receivedSignal!.aborted).toBe(false);
			crawler.abort();
			expect(receivedSignal!.aborted).toBe(true);
		});

		it('deal 正常完了時に crawlEnd イベントが emit される', async () => {
			const { deal } = await import('@d-zero/dealer');
			const { default: Crawler } = await import('./crawler.js');

			vi.mocked(deal).mockImplementation((_items, _factory, options) => {
				// Simulate: abort is called, deal checks signal and resolves normally
				expect(options?.signal).toBeInstanceOf(AbortSignal);
				return Promise.resolve();
			});

			const crawler = new Crawler(defaultOptions);
			let crawlEndEmitted = false;
			crawler.on('crawlEnd', () => {
				crawlEndEmitted = true;
			});

			crawler.start([parseUrl('https://example.com/')!]);

			await vi.waitFor(() => {
				expect(crawlEndEmitted).toBe(true);
			});
		});

		it('二重 abort でもエラーにならない', async () => {
			const { deal } = await import('@d-zero/dealer');
			const { default: Crawler } = await import('./crawler.js');

			vi.mocked(deal).mockResolvedValue();

			const crawler = new Crawler(defaultOptions);
			crawler.start([parseUrl('https://example.com/')!]);

			crawler.abort();
			expect(() => crawler.abort()).not.toThrow();
			expect(crawler.signal.aborted).toBe(true);
		});

		it('signal getter が AbortSignal を返す', async () => {
			const { default: Crawler } = await import('./crawler.js');
			const crawler = new Crawler(defaultOptions);
			expect(crawler.signal).toBeInstanceOf(AbortSignal);
			expect(crawler.signal.aborted).toBe(false);
		});
	});

	describe('start() resume merge', () => {
		it('resuming で pending も新規 root も無ければ crawlEnd を emit して正常終了する', async () => {
			const { deal } = await import('@d-zero/dealer');
			const { default: Crawler } = await import('./crawler.js');
			vi.mocked(deal).mockResolvedValue();

			const crawler = new Crawler(defaultOptions);
			let crawlEnded = false;
			crawler.on('crawlEnd', () => {
				crawlEnded = true;
			});

			crawler.resume([], ['https://example.com/done'], []);
			expect(() => crawler.start([], { recursive: true })).not.toThrow();

			await vi.waitFor(() => {
				expect(crawlEnded).toBe(true);
			});
			expect(deal).not.toHaveBeenCalled();
		});

		it('resumedPending があれば新しい root なしでも開始できる（retry-failed）', async () => {
			const { deal } = await import('@d-zero/dealer');
			const { default: Crawler } = await import('./crawler.js');
			vi.mocked(deal).mockResolvedValue();

			const crawler = new Crawler(defaultOptions);
			crawler.resume(['https://example.com/failed-child'], [], []);
			crawler.start([], { recursive: true });

			await vi.waitFor(() => {
				expect(deal).toHaveBeenCalled();
			});
			const initialUrls = vi.mocked(deal).mock.calls[0]![0] as ExURL[];
			expect(initialUrls.map((u) => u.href)).toEqual([
				'https://example.com/failed-child',
			]);
		});

		it('scraped が空でも resumedPending を初期キューに含める（全ページ失敗 retry）', async () => {
			const { deal } = await import('@d-zero/dealer');
			const { default: Crawler } = await import('./crawler.js');

			let captured: { href: string }[] = [];
			vi.mocked(deal).mockImplementation((items) => {
				captured = items as { href: string }[];
				return Promise.resolve();
			});

			const crawler = new Crawler(defaultOptions);
			// Every page in the archive was a failure: resume with an empty
			// scraped set but a pending (reset) child. Keying isResuming on
			// scraped alone would drop this child entirely.
			crawler.resume(['https://example.com/failed-child'], [], []);
			crawler.start([parseUrl('https://example.com/')!]);

			await vi.waitFor(() => expect(captured.length).toBeGreaterThan(0));

			const hrefs = captured.map((u) => u.href);
			expect(hrefs).toContain('https://example.com/failed-child');
			expect(hrefs).toContain('https://example.com');
		});
	});

	describe('worker-level error handling', () => {
		it('ワーカー内の例外が error イベントとして emit され処理が継続する', async () => {
			const { default: Crawler } = await import('./crawler.js');

			const workerError = new Error('unexpected crash');

			// Simulate deal: call setup function, then invoke the returned work function
			await driveDeal();

			// Mock fetchDestination to throw — triggers the worker catch block
			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockRejectedValue(workerError);

			const crawler = new Crawler(defaultOptions);

			const errors: CrawlerEventTypes['error'][] = [];
			crawler.on('error', (e) => {
				errors.push(e);
			});

			let crawlEndEmitted = false;
			crawler.on('crawlEnd', () => {
				crawlEndEmitted = true;
			});

			crawler.start([parseUrl('https://example.com/')!]);

			await vi.waitFor(() => {
				expect(crawlEndEmitted).toBe(true);
			});

			expect(errors).toHaveLength(1);
			expect(errors[0]!.error.message).toBe('unexpected crash');
			expect(errors[0]!.url).toBe('https://example.com');
		});
	});

	describe('network outage detection', () => {
		/** Low thresholds so two different-host failures reliably trip the detector inside a test's timeout. */
		const outageOptions = {
			...defaultOptions,
			networkOutageWindowMs: 60_000,
			networkOutageErrorThreshold: 2,
			networkOutageHostThreshold: 2,
			// 1ms so the recovery-probe loop iterates fast in real (non-fake) time.
			networkOutageProbeIntervalMs: 1,
		};

		it('confirms an outage (probe fails) once two different hosts fail within the window', async () => {
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');
			const { clearDnsBurnedHostCache } =
				await import('./clear-dns-burned-host-cache.js');
			clearDnsBurnedHostCache();
			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockRejectedValue(
				new Error('getaddrinfo ENOTFOUND'),
			);

			const crawler = new Crawler({
				...outageOptions,
				// Confirmed and stays down for the duration of this test — the
				// recovery loop will keep retrying in the background; it is
				// stopped via abort() in the final assertion step.
				networkProbe: () => Promise.resolve(false),
			});

			const confirmed: CrawlerEventTypes['networkOutageConfirmed'][] = [];
			crawler.on('networkOutageConfirmed', (e) => {
				confirmed.push(e);
			});

			crawler.start([
				parseUrl('https://outage-a.example/')!,
				parseUrl('https://outage-b.example/')!,
			]);

			await vi.waitFor(() => {
				expect(confirmed).toHaveLength(1);
			});
			expect(confirmed[0]!.triggerHostCount).toBeGreaterThanOrEqual(2);
			expect(confirmed[0]!.probeHost).not.toBeNull();

			// Stop the background recovery-probe loop this test left running.
			crawler.abort();
			clearDnsBurnedHostCache();
		});

		it('does NOT confirm an outage when the probe succeeds (false alarm)', async () => {
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');
			const { clearDnsBurnedHostCache } =
				await import('./clear-dns-burned-host-cache.js');
			clearDnsBurnedHostCache();
			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockRejectedValue(
				new Error('getaddrinfo ENOTFOUND'),
			);

			const crawler = new Crawler({
				...outageOptions,
				networkProbe: () => Promise.resolve(true),
			});

			const confirmed: CrawlerEventTypes['networkOutageConfirmed'][] = [];
			crawler.on('networkOutageConfirmed', (e) => {
				confirmed.push(e);
			});

			crawler.start([
				parseUrl('https://falsealarm-a.example/')!,
				parseUrl('https://falsealarm-b.example/')!,
			]);

			await vi.waitFor(() => {
				expect(confirmed).toHaveLength(0);
			});
			// A short grace period confirms this isn't just "hasn't fired yet" —
			// the false-alarm probe already resolved by the time driveDeal's
			// synchronous loop finished, so nothing further can arrive.
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(confirmed).toHaveLength(0);
			clearDnsBurnedHostCache();
		});

		it('emits networkOutageRecovered once a later probe succeeds', async () => {
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');
			const { clearDnsBurnedHostCache } =
				await import('./clear-dns-burned-host-cache.js');
			clearDnsBurnedHostCache();
			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockRejectedValue(
				new Error('getaddrinfo ENOTFOUND'),
			);

			let probeCallCount = 0;
			const crawler = new Crawler({
				...outageOptions,
				networkProbe: () => {
					probeCallCount++;
					// Fail the confirming probe and the first recovery attempt,
					// then succeed.
					return Promise.resolve(probeCallCount > 2);
				},
			});

			const confirmed: CrawlerEventTypes['networkOutageConfirmed'][] = [];
			const recovered: CrawlerEventTypes['networkOutageRecovered'][] = [];
			crawler.on('networkOutageConfirmed', (e) => confirmed.push(e));
			crawler.on('networkOutageRecovered', (e) => recovered.push(e));

			crawler.start([
				parseUrl('https://recover-a.example/')!,
				parseUrl('https://recover-b.example/')!,
			]);

			await vi.waitFor(() => {
				expect(confirmed).toHaveLength(1);
			});
			await vi.waitFor(() => {
				expect(recovered).toHaveLength(1);
			});
			expect(typeof recovered[0]!.endedAt).toBe('number');
			clearDnsBurnedHostCache();
		});

		it('evicts network-classified destinationCache/dnsBurnedHostCache entries on recovery, preserving unrelated ones', async () => {
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');
			const { clearDnsBurnedHostCache } =
				await import('./clear-dns-burned-host-cache.js');
			clearDnsBurnedHostCache();
			const { destinationCache } = await import('./destination-cache.js');
			const { dnsBurnedHostCache } = await import('./dns-burned-host-cache.js');
			destinationCache.clear();

			// Pre-existing cache state, unrelated to the outage this test
			// triggers: a site-specific failure (client-blocked) that must
			// survive, and a preload-seeded DNS burn (no corresponding
			// burn-timestamp entry) that must also survive.
			destinationCache.set(
				'https://blocked.example/',
				new Error('ERR_BLOCKED_BY_CLIENT'),
			);
			dnsBurnedHostCache.set('preload-seeded.example', 'dns');

			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockRejectedValue(
				new Error('getaddrinfo ENOTFOUND'),
			);

			let probeCallCount = 0;
			const crawler = new Crawler({
				...outageOptions,
				networkProbe: () => {
					probeCallCount++;
					return Promise.resolve(probeCallCount > 1);
				},
			});

			const recovered: CrawlerEventTypes['networkOutageRecovered'][] = [];
			crawler.on('networkOutageRecovered', (e) => recovered.push(e));

			crawler.start([
				parseUrl('https://evict-a.example/')!,
				parseUrl('https://evict-b.example/')!,
			]);

			await vi.waitFor(() => {
				expect(recovered).toHaveLength(1);
			});

			// The two failing URLs' retry storms burn their own hosts into
			// dnsBurnedHostCache with a REAL burn timestamp (via the
			// production onGiveUp path) — those must be gone after recovery.
			expect(dnsBurnedHostCache.has('evict-a.example')).toBe(false);
			expect(dnsBurnedHostCache.has('evict-b.example')).toBe(false);
			// The unrelated pre-existing entries must survive.
			expect(dnsBurnedHostCache.has('preload-seeded.example')).toBe(true);
			expect(destinationCache.get('https://blocked.example/')).toBeInstanceOf(Error);

			destinationCache.clear();
			clearDnsBurnedHostCache();
		});

		it('reopens the gate on abort without emitting networkOutageRecovered, unblocking a paused worker', async () => {
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');
			const { clearDnsBurnedHostCache } =
				await import('./clear-dns-burned-host-cache.js');
			clearDnsBurnedHostCache();
			const fetchDestMod = await import('./fetch-destination.js');
			const fetchSpy = vi
				.spyOn(fetchDestMod, 'fetchDestination')
				.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

			const crawler = new Crawler({
				...outageOptions,
				// Stays down for the whole test — only abort() should unblock it.
				networkProbe: () => Promise.resolve(false),
			});

			const recovered: CrawlerEventTypes['networkOutageRecovered'][] = [];
			crawler.on('networkOutageRecovered', (e) => recovered.push(e));

			crawler.start([
				parseUrl('https://abort-a.example/')!,
				parseUrl('https://abort-b.example/')!,
				parseUrl('https://abort-c.example/')!,
			]);

			// Wait until the third URL's HEAD attempt would have started if the
			// gate were open — i.e. until fetchDestination has been called for
			// every one of the three URLs. Before the abort, item 3 should be
			// stuck on `#networkGate.wait()` and never reach fetchDestination.
			await new Promise((resolve) => setTimeout(resolve, 20));
			const urlsFetched = fetchSpy.mock.calls.map(
				(call) => (call[0] as { url: { href: string } }).url.href,
			);
			expect(urlsFetched).not.toContain('https://abort-c.example');

			crawler.abort();

			await vi.waitFor(() => {
				const urlsFetchedAfterAbort = fetchSpy.mock.calls.map(
					(call) => (call[0] as { url: { href: string } }).url.href,
				);
				expect(urlsFetchedAfterAbort).toContain('https://abort-c.example');
			});
			expect(recovered).toHaveLength(0);
			clearDnsBurnedHostCache();
		});
	});

	describe('resource reuse via the lookupResource option', () => {
		it('キャプチャ済みリソースが再利用され、ネットワークフェッチが一切発生しない', async () => {
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');

			// Any network access fails the test: reuse must satisfy the URL alone
			const fetchDestMod = await import('./fetch-destination.js');
			const fetchSpy = vi
				.spyOn(fetchDestMod, 'fetchDestination')
				.mockRejectedValue(new Error('network must not be touched'));

			const crawler = new Crawler({
				...defaultOptions,
				lookupResource: () =>
					Promise.resolve({
						status: 200,
						statusText: 'OK',
						contentType: 'image/png',
						contentLength: 1234,
						responseHeaders: { 'content-type': 'image/png' },
					}),
			});
			// Seed the known-resources set the same way a resumed session does
			crawler.resume([], [], ['https://example.com/img.png']);

			const pages: CrawlerEventTypes['page'][] = [];
			crawler.on('page', (p) => {
				pages.push(p);
			});

			crawler.start([parseUrl('https://example.com/img.png')!]);

			await vi.waitFor(() => {
				expect(pages).toHaveLength(1);
			});
			expect(pages[0]!.result.status).toBe(200);
			expect(pages[0]!.result.statusText).toBe('OK');
			expect(pages[0]!.result.contentType).toBe('image/png');
			expect(pages[0]!.result.contentLength).toBe(1234);
			expect(fetchSpy).not.toHaveBeenCalled();
		});

		it('lookup が失敗してもクロールは止まらず HEAD プリフライトにフォールバックする', async () => {
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');

			const url = parseUrl('https://example.com/img.png')!;
			const fetchDestMod = await import('./fetch-destination.js');
			const fetchSpy = vi.spyOn(fetchDestMod, 'fetchDestination').mockResolvedValue({
				url,
				redirectPaths: [],
				isTarget: true,
				isExternal: false,
				status: 200,
				statusText: 'OK',
				contentType: 'image/png',
				contentLength: 1234,
				responseHeaders: {},
				meta: { title: '' },
				anchorList: [],
				imageList: [],
				html: '',
				isSkipped: false,
			});

			const crawler = new Crawler({
				...defaultOptions,
				lookupResource: () => Promise.reject(new Error('db read failed')),
			});
			crawler.resume([], [], ['https://example.com/img.png']);

			const pages: CrawlerEventTypes['page'][] = [];
			const errors: CrawlerEventTypes['error'][] = [];
			crawler.on('page', (p) => {
				pages.push(p);
			});
			crawler.on('error', (e) => {
				errors.push(e);
			});

			crawler.start([url]);

			await vi.waitFor(() => {
				expect(pages).toHaveLength(1);
			});
			expect(errors).toHaveLength(0);
			expect(fetchSpy).toHaveBeenCalledTimes(1);
			expect(pages[0]!.result.status).toBe(200);
		});
	});

	describe('discovered-URL queue prioritisation', () => {
		/**
		 * Build a minimal non-HTML scrape result whose anchorList is returned by
		 * the HEAD pre-flight. A non-HTML content type makes #scrapePage skip the
		 * browser and return the pre-flight result verbatim, so the supplied
		 * anchors flow into handleScrapeEnd → enqueue without launching Puppeteer.
		 * @param anchors - Anchors to expose on the scraped page.
		 * @returns A PageData-shaped object for fetchDestination to resolve with.
		 */
		function nonHtmlResultWithAnchors(anchors: { href: ExURL; textContent: string }[]) {
			return {
				url: parseUrl('https://example.com/feed.xml')!,
				redirectPaths: [],
				isTarget: false,
				isExternal: false,
				status: 200,
				statusText: 'OK',
				contentType: 'application/xml',
				contentLength: 0,
				responseHeaders: {},
				meta: { title: '' },
				anchorList: anchors,
				imageList: [],
				html: '',
				isSkipped: false,
			};
		}

		it('HTML らしい発見 URL は unshift、アセット URL は push に振り分けられる', async () => {
			const { push, unshift } = await driveDeal();
			const { default: Crawler } = await import('./crawler.js');

			const htmlAnchor = parseUrl('https://example.com/about')!;
			const assetAnchor = parseUrl('https://example.com/doc.pdf')!;

			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockResolvedValue(
				nonHtmlResultWithAnchors([
					{ href: htmlAnchor, textContent: 'About' },
					{ href: assetAnchor, textContent: 'PDF' },
				]) as Awaited<ReturnType<typeof fetchDestMod.fetchDestination>>,
			);

			const crawler = new Crawler(defaultOptions);
			let crawlEndEmitted = false;
			crawler.on('crawlEnd', () => {
				crawlEndEmitted = true;
			});

			crawler.start([parseUrl('https://example.com/feed.xml')!]);

			await vi.waitFor(() => {
				expect(crawlEndEmitted).toBe(true);
			});

			expect(unshift).toHaveBeenCalledTimes(1);
			expect(unshift).toHaveBeenCalledWith(htmlAnchor);
			expect(push).toHaveBeenCalledTimes(1);
			expect(push).toHaveBeenCalledWith(assetAnchor);
		});

		it('予測ページネーション URL は1回の unshift で昇順のままバッチ投入される', async () => {
			const { unshift } = await driveDeal();
			const { default: Crawler } = await import('./crawler.js');

			// Two consecutive numeric anchors trigger pagination prediction.
			const page2 = parseUrl('https://example.com/page/2')!;
			const page3 = parseUrl('https://example.com/page/3')!;

			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockResolvedValue(
				nonHtmlResultWithAnchors([
					{ href: page2, textContent: 'Page 2' },
					{ href: page3, textContent: 'Page 3' },
				]) as Awaited<ReturnType<typeof fetchDestMod.fetchDestination>>,
			);

			// parallels: 3 → three predicted URLs (page/4, page/5, page/6).
			const crawler = new Crawler({ ...defaultOptions, parallels: 3 });
			let crawlEndEmitted = false;
			crawler.on('crawlEnd', () => {
				crawlEndEmitted = true;
			});

			crawler.start([parseUrl('https://example.com/feed.xml')!]);

			await vi.waitFor(() => {
				expect(crawlEndEmitted).toBe(true);
			});

			// The predicted batch must arrive as ONE unshift call (not three reversed
			// individual calls), preserving ascending page order at the queue front.
			const batchCall = unshift.mock.calls.find((args) => args.length === 3);
			expect(batchCall).toBeDefined();
			expect((batchCall as unknown as ExURL[]).map((u) => u.withoutHashAndAuth)).toEqual([
				'https://example.com/page/4',
				'https://example.com/page/5',
				'https://example.com/page/6',
			]);
		});

		it('--dedupe-cap: 既にcapped済みのshapeを持つ新規anchorはenqueueされない', async () => {
			const { push, unshift } = await driveDeal();
			const { default: Crawler } = await import('./crawler.js');
			const { computeShapeKey } = await import('./dedupe/compute-shape-key.js');

			const htmlAnchor = parseUrl('https://example.com/about')!;
			const assetAnchor = parseUrl('https://example.com/doc.pdf')!;
			const cappedShapeKey = computeShapeKey(htmlAnchor.withoutHashAndAuth)!;

			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockResolvedValue(
				nonHtmlResultWithAnchors([
					{ href: htmlAnchor, textContent: 'About' },
					{ href: assetAnchor, textContent: 'PDF' },
				]) as Awaited<ReturnType<typeof fetchDestMod.fetchDestination>>,
			);

			const crawler = new Crawler({
				...defaultOptions,
				dedupeCap: 100,
				preloadedStickyShapeKeys: [cappedShapeKey],
			});
			let crawlEndEmitted = false;
			crawler.on('crawlEnd', () => {
				crawlEndEmitted = true;
			});

			crawler.start([parseUrl('https://example.com/feed.xml')!]);

			await vi.waitFor(() => {
				expect(crawlEndEmitted).toBe(true);
			});

			// htmlAnchor's shape was preloaded as capped (gate 1) → never enqueued.
			expect(unshift).not.toHaveBeenCalled();
			// assetAnchor has a different shape → unaffected, still routed to push.
			expect(push).toHaveBeenCalledWith(assetAnchor);
		});

		it('--dedupe-cap かつ --recursive=false（anchorがmetadataOnlyになる）でも既にcapped済みのshapeはenqueueされない', async () => {
			// With `recursive: false`, handle-scrape-end.ts marks EVERY anchor
			// metadata-only (internal or not) — regression guard that gate 1
			// still blocks a capped shape's anchor in this mode instead of
			// silently letting it through (which would make `--dedupe-cap`
			// inconsistent with gate 2's JS-redirect check, which has no
			// metadataOnly exclusion).
			const { unshift } = await driveDeal();
			const { default: Crawler } = await import('./crawler.js');
			const { computeShapeKey } = await import('./dedupe/compute-shape-key.js');

			const htmlAnchor = parseUrl('https://example.com/about')!;
			const cappedShapeKey = computeShapeKey(htmlAnchor.withoutHashAndAuth)!;

			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockResolvedValue(
				nonHtmlResultWithAnchors([{ href: htmlAnchor, textContent: 'About' }]) as Awaited<
					ReturnType<typeof fetchDestMod.fetchDestination>
				>,
			);

			const crawler = new Crawler({
				...defaultOptions,
				recursive: false,
				dedupeCap: 100,
				preloadedStickyShapeKeys: [cappedShapeKey],
			});
			let crawlEndEmitted = false;
			crawler.on('crawlEnd', () => {
				crawlEndEmitted = true;
			});

			crawler.start([parseUrl('https://example.com/feed.xml')!]);

			await vi.waitFor(() => {
				expect(crawlEndEmitted).toBe(true);
			});

			expect(unshift).not.toHaveBeenCalled();
		});
	});

	describe('body hash computed once per page (regression: computeBodyHash double-counted)', () => {
		/**
		 * Minimal non-HTML PageData builder carrying real `html` content — a
		 * non-HTML `contentType` makes `#scrapePage` return the HEAD pre-flight
		 * result verbatim (same trick `nonHtmlPageData` above uses), so the
		 * body-hash computation under test runs without needing a mocked
		 * Chromium instance.
		 * @param url - The page's own URL.
		 * @param html - The page's body content.
		 * @returns A PageData-shaped object for fetchDestination to resolve with.
		 */
		function htmlBodyPageData(url: ExURL, html: string) {
			return {
				url,
				redirectPaths: [],
				isTarget: true,
				isExternal: false,
				status: 200,
				statusText: 'OK',
				contentType: 'application/xml',
				contentLength: 0,
				responseHeaders: {},
				meta: { title: '' },
				anchorList: [],
				imageList: [],
				html,
				isSkipped: false,
			};
		}

		it('page イベントの payload に実 html から計算した body hash が乗る', async () => {
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');
			const { computeBodyHash } =
				await import('../archive/body-hash/compute-body-hash.js');

			const origin = parseUrl('https://example.com/')!;
			const html = '<html><body>hello</body></html>';
			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockResolvedValue(
				htmlBodyPageData(origin, html) as Awaited<
					ReturnType<typeof fetchDestMod.fetchDestination>
				>,
			);

			const crawler = new Crawler(defaultOptions);
			const pages: CrawlerEventTypes['page'][] = [];
			crawler.on('page', (p) => {
				pages.push(p);
			});
			let crawlEndEmitted = false;
			crawler.on('crawlEnd', () => {
				crawlEndEmitted = true;
			});

			crawler.start([origin]);

			await vi.waitFor(() => {
				expect(crawlEndEmitted).toBe(true);
			});

			expect(pages).toHaveLength(1);
			expect(pages[0]!.bodyHash).toBeInstanceOf(Buffer);
			expect(pages[0]!.bodyHash!.equals(computeBodyHash(html))).toBe(true);
		});

		it('--dedupe-cap 有効時も computeBodyHash は1ページにつき1回だけ呼ばれる', async () => {
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');
			const computeBodyHashMod =
				await import('../archive/body-hash/compute-body-hash.js');
			const computeBodyHashSpy = vi.spyOn(computeBodyHashMod, 'computeBodyHash');

			const origin = parseUrl('https://example.com/')!;
			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockResolvedValue(
				htmlBodyPageData(origin, '<html><body>hello</body></html>') as Awaited<
					ReturnType<typeof fetchDestMod.fetchDestination>
				>,
			);

			const crawler = new Crawler({ ...defaultOptions, dedupeCap: 100 });
			let crawlEndEmitted = false;
			crawler.on('crawlEnd', () => {
				crawlEndEmitted = true;
			});

			crawler.start([origin]);

			await vi.waitFor(() => {
				expect(crawlEndEmitted).toBe(true);
			});

			expect(computeBodyHashSpy).toHaveBeenCalledTimes(1);
		});

		it('外部ページでは html が非空でも computeBodyHash が呼ばれない（body_hash は外部ページに書き込まれないため不要）', async () => {
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');
			const computeBodyHashMod =
				await import('../archive/body-hash/compute-body-hash.js');
			const computeBodyHashSpy = vi.spyOn(computeBodyHashMod, 'computeBodyHash');

			// Outside `defaultOptions.roots` (`https://example.com/`), so
			// `findScopeEntry` classifies this as external — `fetchExternal`
			// defaults to `true`, so it still renders through the normal
			// (non-early-return) path instead of the `!fetchExternal` shortcut.
			const externalUrl = parseUrl('https://external.example/')!;
			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockResolvedValue({
				...htmlBodyPageData(externalUrl, '<html><body>external</body></html>'),
				isExternal: true,
			} as Awaited<ReturnType<typeof fetchDestMod.fetchDestination>>);

			const crawler = new Crawler({ ...defaultOptions, dedupeCap: 100 });
			const externalPages: CrawlerEventTypes['externalPage'][] = [];
			crawler.on('externalPage', (p) => {
				externalPages.push(p);
			});
			let crawlEndEmitted = false;
			crawler.on('crawlEnd', () => {
				crawlEndEmitted = true;
			});

			crawler.start([externalUrl]);

			await vi.waitFor(() => {
				expect(crawlEndEmitted).toBe(true);
			});

			expect(externalPages).toHaveLength(1);
			expect(computeBodyHashSpy).not.toHaveBeenCalled();
		});
	});

	describe('predicted-page content-duplicate discard (always-on, issue #208)', () => {
		/**
		 * Minimal non-HTML PageData builder — a non-HTML `contentType` makes
		 * `#scrapePage` return the HEAD pre-flight result verbatim, skipping
		 * the browser entirely (same trick `nonHtmlResultWithAnchors` above
		 * uses), while still letting `html` carry real content so the A-3
		 * body-hash comparison has something to compare.
		 * @param url - The page's own URL.
		 * @param anchors - Anchors to expose on the scraped page.
		 * @param html - The page's body content.
		 * @returns A PageData-shaped object for fetchDestination to resolve with.
		 */
		function nonHtmlPageData(
			url: ExURL,
			anchors: { href: ExURL; textContent: string }[],
			html: string,
		) {
			return {
				url,
				redirectPaths: [],
				isTarget: false,
				isExternal: false,
				status: 200,
				statusText: 'OK',
				contentType: 'application/xml',
				contentLength: 0,
				responseHeaders: {},
				meta: { title: '' },
				anchorList: anchors,
				imageList: [],
				html,
				isSkipped: false,
			};
		}

		it('連続する予測ページの本文が同一なら2件目以降を破棄し、pageイベントを発火しない', async () => {
			await driveDealRecursive();
			const { default: Crawler } = await import('./crawler.js');

			const origin = parseUrl('https://example.com/feed.xml')!;
			const page2 = parseUrl('https://example.com/page/2')!;
			const page3 = parseUrl('https://example.com/page/3')!;
			const page4 = parseUrl('https://example.com/page/4')!;
			const page5 = parseUrl('https://example.com/page/5')!;

			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockImplementation((args) => {
				const href = (args as { url: ExURL }).url.withoutHashAndAuth;
				if (href === page4.withoutHashAndAuth || href === page5.withoutHashAndAuth) {
					// Both predicted pages render byte-for-byte identical bodies —
					// the site ignores the extrapolated page number entirely.
					return Promise.resolve(
						nonHtmlPageData(parseUrl(href)!, [], '<p>duplicate</p>') as Awaited<
							ReturnType<typeof fetchDestMod.fetchDestination>
						>,
					);
				}
				return Promise.resolve(
					nonHtmlPageData(
						origin,
						[
							{ href: page2, textContent: 'Page 2' },
							{ href: page3, textContent: 'Page 3' },
						],
						'',
					) as Awaited<ReturnType<typeof fetchDestMod.fetchDestination>>,
				);
			});

			// parallels: 2 → two predicted URLs of the same shape (page/4, page/5),
			// dealt in order by driveDealRecursive so page/4 is scraped (and its
			// body hash recorded) before page/5 is compared against it.
			const crawler = new Crawler({ ...defaultOptions, parallels: 2 });
			const pages: CrawlerEventTypes['page'][] = [];
			crawler.on('page', (p) => {
				pages.push(p);
			});
			let crawlEndEmitted = false;
			crawler.on('crawlEnd', () => {
				crawlEndEmitted = true;
			});

			crawler.start([origin]);

			await vi.waitFor(() => {
				expect(crawlEndEmitted).toBe(true);
			});

			const pageUrls = pages.map((p) => p.result.url.withoutHashAndAuth);
			expect(pageUrls).toContain(page4.withoutHashAndAuth);
			expect(pageUrls).not.toContain(page5.withoutHashAndAuth);
		});
	});

	describe('same-cluster cap gate 2: JS-redirect direct enqueue (issue #208)', () => {
		it('JS-redirectの着地先URLのshapeが既にcapped済みなら、addUrlクロージャ（gate 1）を経由せずにenqueueをブロックし拒否数を記録する', async () => {
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');
			const { computeShapeKey } = await import('./dedupe/compute-shape-key.js');

			const sourceUrl = parseUrl('https://example.com/redirector')!;
			const destinationUrl = parseUrl('https://example.com/trap/99')!;
			const cappedShapeKey = computeShapeKey(destinationUrl.withoutHashAndAuth)!;

			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockResolvedValue({
				url: sourceUrl,
				redirectPaths: [],
				isTarget: true,
				isExternal: false,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 0,
				responseHeaders: {},
				meta: { title: '' },
				anchorList: [],
				imageList: [],
				html: '',
				isSkipped: false,
			} as Awaited<ReturnType<typeof fetchDestMod.fetchDestination>>);

			// `_launchBrowserAndScrape` is the sanctioned test-only hook for
			// driving the js-redirect cascade without a real browser (see its
			// own JSDoc `@internal` note).
			vi.spyOn(
				Crawler.prototype as unknown as {
					_launchBrowserAndScrape: (...args: unknown[]) => Promise<unknown>;
				},
				'_launchBrowserAndScrape',
			).mockResolvedValue({
				type: 'redirect-edge',
				source: 'js-redirect',
				pageData: {
					url: sourceUrl,
					redirectPaths: [destinationUrl.href],
					isTarget: true,
					isExternal: false,
					status: 200,
					statusText: 'OK',
					contentType: 'text/html',
					contentLength: 0,
					responseHeaders: {},
					meta: { title: '' },
					anchorList: [],
					imageList: [],
					html: '',
					isSkipped: false,
				},
			});

			const crawler = new Crawler({
				...defaultOptions,
				dedupeCap: 100,
				preloadedStickyShapeKeys: [cappedShapeKey],
			});
			let crawlEndEmitted = false;
			crawler.on('crawlEnd', () => {
				crawlEndEmitted = true;
			});

			crawler.start([sourceUrl]);

			await vi.waitFor(() => {
				expect(crawlEndEmitted).toBe(true);
			});

			// Gate 2 rejects the JS-redirect destination before it is ever
			// enqueued — this path does not go through the addUrl closure
			// (gate 1) at all, so this is the only place that can catch a
			// regression here.
			expect(crawler.getDedupeCapRejections().get(cappedShapeKey)).toBe(1);
		});
	});

	describe('paginationState is scoped per page (issue #208 regression guard)', () => {
		it('別ページ由来の連番URL同士を比較して予測URLを生成しない', async () => {
			const { unshift } = await driveDeal();
			const { default: Crawler } = await import('./crawler.js');

			const pageA = parseUrl('https://example.com/page-a.xml')!;
			const pageB = parseUrl('https://example.com/page-b.xml')!;
			const productA1 = parseUrl('https://example.com/product/1')!;
			const productB2 = parseUrl('https://example.com/product/2')!;

			/**
			 *
			 * @param url
			 * @param anchors
			 */
			function nonHtmlResult(
				url: ExURL,
				anchors: { href: ExURL; textContent: string }[],
			) {
				return {
					url,
					redirectPaths: [],
					isTarget: false,
					isExternal: false,
					status: 200,
					statusText: 'OK',
					contentType: 'application/xml',
					contentLength: 0,
					responseHeaders: {},
					meta: { title: '' },
					anchorList: anchors,
					imageList: [],
					html: '',
					isSkipped: false,
				};
			}

			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockImplementation((args) => {
				const href = (args as { url: ExURL }).url.withoutHashAndAuth;
				if (href === pageA.withoutHashAndAuth) {
					return Promise.resolve(
						nonHtmlResult(pageA, [
							{ href: productA1, textContent: 'Product 1' },
						]) as Awaited<ReturnType<typeof fetchDestMod.fetchDestination>>,
					);
				}
				return Promise.resolve(
					nonHtmlResult(pageB, [
						{ href: productB2, textContent: 'Product 2' },
					]) as Awaited<ReturnType<typeof fetchDestMod.fetchDestination>>,
				);
			});

			// parallels: 2 → if a (bogus) pattern were detected, two predicted
			// URLs would be generated and unshifted as ONE batched call.
			const crawler = new Crawler({ ...defaultOptions, parallels: 2 });
			let crawlEndEmitted = false;
			crawler.on('crawlEnd', () => {
				crawlEndEmitted = true;
			});

			// Two SEPARATE root pages, each contributing exactly ONE anchor.
			// Under the pre-fix bug (`paginationState` declared once per crawl
			// in `#runDeal`, shared across every page's `#handleResult`),
			// product/1 (page A's only push) would still be
			// `paginationState.lastPushedUrl` when product/2 (page B's only
			// push) is processed — despite the two anchors never appearing
			// together on the same document, they would look like a valid
			// numeric pagination pair and trigger prediction. The fix scopes
			// `paginationState` fresh to each `#handleResult` invocation, so
			// page B's processing starts with `lastPushedUrl: null` and no
			// cross-page comparison ever happens.
			crawler.start([pageA, pageB]);

			await vi.waitFor(() => {
				expect(crawlEndEmitted).toBe(true);
			});

			// Real single-anchor routing always calls unshift with exactly one
			// URL; only a (bogus) predicted-URL batch would call it with more
			// than one, so this is the discriminating assertion.
			const batchCalls = unshift.mock.calls.filter((args) => args.length > 1);
			expect(batchCalls).toHaveLength(0);
		});
	});

	describe('start() with the unified signature', () => {
		it('throws when given an empty url list', async () => {
			const { default: Crawler } = await import('./crawler.js');
			const crawler = new Crawler(defaultOptions);
			expect(() => crawler.start([])).toThrow('urls is empty');
		});

		it('passes every supplied root as an initial url to deal()', async () => {
			const { deal } = await import('@d-zero/dealer');
			const { default: Crawler } = await import('./crawler.js');
			vi.mocked(deal).mockResolvedValue();

			const crawler = new Crawler(defaultOptions);
			const urls = [
				parseUrl('https://example.com/blog/')!,
				parseUrl('https://example.com/news/')!,
			];
			crawler.start(urls, { recursive: true });

			await vi.waitFor(() => {
				expect(deal).toHaveBeenCalled();
			});
			const initialUrls = vi.mocked(deal).mock.calls[0]![0] as ExURL[];
			expect(initialUrls.map((u) => u.pathname)).toEqual(['/blog/', '/news/']);
		});

		it('merges resumed pending URLs with newly-supplied roots when resuming', async () => {
			const { deal } = await import('@d-zero/dealer');
			const { default: Crawler } = await import('./crawler.js');
			vi.mocked(deal).mockResolvedValue();

			const crawler = new Crawler(defaultOptions);
			crawler.resume(
				['https://example.com/pending-1'],
				['https://example.com/scraped-1'],
				[],
			);
			crawler.start([parseUrl('https://example.com/new-root')!], { recursive: true });

			await vi.waitFor(() => {
				expect(deal).toHaveBeenCalled();
			});
			const initialUrls = vi.mocked(deal).mock.calls[0]![0] as ExURL[];
			const hrefs = initialUrls.map((u) => u.href);
			expect(hrefs).toContain('https://example.com/pending-1');
			expect(hrefs).toContain('https://example.com/new-root');
		});

		it('deduplicates a URL that is in both resumedPending and the new roots', async () => {
			// Repro of the append-mode bug: a previously-external page that
			// gets repromoted into pending and is ALSO supplied as a new
			// root must reach the dealer exactly once, otherwise two
			// parallel slots scrape the same URL in parallel.
			const { deal } = await import('@d-zero/dealer');
			const { default: Crawler } = await import('./crawler.js');
			vi.mocked(deal).mockResolvedValue();

			const crawler = new Crawler(defaultOptions);
			const shared = 'https://example.com/section/';
			crawler.resume([shared], ['https://example.com/root/'], []);
			crawler.start([parseUrl(shared)!], { recursive: true });

			await vi.waitFor(() => {
				expect(deal).toHaveBeenCalled();
			});
			const initialUrls = vi.mocked(deal).mock.calls[0]![0] as ExURL[];
			const occurrences = initialUrls.filter((u) => u.href === shared);
			expect(occurrences).toHaveLength(1);
		});

		it('deduplicates duplicate roots within a single start() call', async () => {
			const { deal } = await import('@d-zero/dealer');
			const { default: Crawler } = await import('./crawler.js');
			vi.mocked(deal).mockResolvedValue();

			const crawler = new Crawler(defaultOptions);
			crawler.start(
				[
					parseUrl('https://example.com/blog/')!,
					parseUrl('https://example.com/blog/')!,
					parseUrl('https://example.com/news/')!,
				],
				{ recursive: true },
			);

			await vi.waitFor(() => {
				expect(deal).toHaveBeenCalled();
			});
			const initialUrls = vi.mocked(deal).mock.calls[0]![0] as ExURL[];
			expect(initialUrls.map((u) => u.pathname)).toEqual(['/blog/', '/news/']);
		});
	});

	describe('HEAD pre-flight timeout escalation', () => {
		it('passes escalating timeouts (10s → 30s → 60s) to fetchDestination across retry attempts', async () => {
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');
			const { clearDnsBurnedHostCache } =
				await import('./clear-dns-burned-host-cache.js');
			clearDnsBurnedHostCache();

			const fetchDestMod = await import('./fetch-destination.js');
			const fetchSpy = vi
				.spyOn(fetchDestMod, 'fetchDestination')
				.mockRejectedValue(new Error('Timeout: https://slow.example.com/'));

			const crawler = new Crawler(defaultOptions);
			crawler.on('error', () => {});

			crawler.start([parseUrl('https://slow.example.com/')!]);

			await vi.waitFor(() => {
				expect(fetchSpy).toHaveBeenCalledTimes(4); // retry=3 → 1 + 3 attempts
			});

			// Attempt-indexed timeout: first call short for a fast healthy site,
			// later calls generous so a slow-but-reachable server gets a chance.
			expect(fetchSpy.mock.calls[0]![0]).toMatchObject({ timeout: 10_000 });
			expect(fetchSpy.mock.calls[1]![0]).toMatchObject({ timeout: 30_000 });
			expect(fetchSpy.mock.calls[2]![0]).toMatchObject({ timeout: 60_000 });
			// Anything past the declared array falls back to the max budget.
			expect(fetchSpy.mock.calls[3]![0]).toMatchObject({ timeout: 60_000 });

			clearDnsBurnedHostCache();
		});
	});

	describe('DNS-burned host cache', () => {
		it('marks the host as DNS-burned when the HEAD pre-flight gives up with an ENOTFOUND error', async () => {
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');
			const { dnsBurnedHostCache } = await import('./dns-burned-host-cache.js');
			const { clearDnsBurnedHostCache } =
				await import('./clear-dns-burned-host-cache.js');
			clearDnsBurnedHostCache();

			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockRejectedValue(
				new Error('getaddrinfo ENOTFOUND foo.invalid'),
			);

			const crawler = new Crawler(defaultOptions);
			const errors: CrawlerEventTypes['error'][] = [];
			crawler.on('error', (e) => {
				errors.push(e);
			});

			crawler.start([parseUrl('https://foo.invalid/page-1')!]);

			await vi.waitFor(() => {
				expect(errors).toHaveLength(1);
			});

			expect(dnsBurnedHostCache.get('foo.invalid')).toBe('dns');
			clearDnsBurnedHostCache();
		});

		it('short-circuits subsequent URLs on a burned host without invoking fetchDestination', async () => {
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');
			const { dnsBurnedHostCache } = await import('./dns-burned-host-cache.js');
			const { dnsBurnedHostShortCircuitCounter } =
				await import('./dns-burned-host-short-circuit-counter.js');
			const { clearDnsBurnedHostCache } =
				await import('./clear-dns-burned-host-cache.js');
			clearDnsBurnedHostCache();
			dnsBurnedHostCache.set('foo.invalid', 'dns');

			const fetchDestMod = await import('./fetch-destination.js');
			const fetchSpy = vi.spyOn(fetchDestMod, 'fetchDestination');

			const crawler = new Crawler(defaultOptions);
			const errors: CrawlerEventTypes['error'][] = [];
			crawler.on('error', (e) => {
				errors.push(e);
			});

			crawler.start([parseUrl('https://foo.invalid/page-2')!]);

			await vi.waitFor(() => {
				expect(errors).toHaveLength(1);
			});

			expect(fetchSpy).not.toHaveBeenCalled();
			// Identifying via `name` instead of `instanceof` insulates the
			// assertion from any class-identity divergence between static and
			// dynamic ESM imports under the vitest module loader.
			expect(errors[0]!.error.name).toBe('PreloadShortCircuitError');
			expect(dnsBurnedHostShortCircuitCounter.count).toBeGreaterThanOrEqual(1);
			clearDnsBurnedHostCache();
		});

		it('does not burn the host for transient timeout failures', async () => {
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');
			const { dnsBurnedHostCache } = await import('./dns-burned-host-cache.js');
			const { clearDnsBurnedHostCache } =
				await import('./clear-dns-burned-host-cache.js');
			clearDnsBurnedHostCache();

			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockRejectedValue(
				new Error('connect ETIMEDOUT 93.184.216.34:443'),
			);

			const crawler = new Crawler(defaultOptions);
			const errors: CrawlerEventTypes['error'][] = [];
			crawler.on('error', (e) => {
				errors.push(e);
			});

			crawler.start([parseUrl('https://slow.example.com/page')!]);

			await vi.waitFor(() => {
				expect(errors).toHaveLength(1);
			});

			expect(dnsBurnedHostCache.has('slow.example.com')).toBe(false);
			clearDnsBurnedHostCache();
		});

		it('uses the lowercased hostname as the cache key', async () => {
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');
			const { dnsBurnedHostCache } = await import('./dns-burned-host-cache.js');
			const { clearDnsBurnedHostCache } =
				await import('./clear-dns-burned-host-cache.js');
			clearDnsBurnedHostCache();

			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockRejectedValue(
				new Error('getaddrinfo ENOTFOUND mixed.invalid'),
			);

			const crawler = new Crawler(defaultOptions);
			crawler.on('error', () => {});

			// The WHATWG URL parser lowercases the hostname already, but the cache
			// codifies the contract: only lowercased keys round-trip.
			crawler.start([parseUrl('https://Mixed.INVALID/page')!]);

			await vi.waitFor(() => {
				expect(dnsBurnedHostCache.has('mixed.invalid')).toBe(true);
			});

			expect(dnsBurnedHostCache.has('Mixed.INVALID')).toBe(false);
			clearDnsBurnedHostCache();
		});

		it('does NOT burn a host whose earlier URL responded in this session', async () => {
			// Cascade guard: a DNS failure on a host that already proved alive
			// (some earlier URL on the host received an HTTP response in this
			// session) is treated as a transient local-network blip — operator
			// flipped WiFi → tethering / VPN / ISP DNS hiccup — and the burn
			// is suppressed. Without this guard, the first ENOTFOUND after the
			// blip would short-circuit every remaining URL on the host into a
			// degenerate `crawlEnd`. `driveDeal` runs the seed URLs
			// sequentially in this test stub, so the first URL completes
			// (populating `#successfulHosts`) strictly before the second
			// reaches `onGiveUp`.
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');
			const { dnsBurnedHostCache } = await import('./dns-burned-host-cache.js');
			const { clearDnsBurnedHostCache } =
				await import('./clear-dns-burned-host-cache.js');
			clearDnsBurnedHostCache();

			// Use a non-HTML contentType so the success URL resolves on HEAD
			// alone (no puppeteer launch required in the test mock surface).
			// The cascade-guard semantics are content-type-independent: any
			// `fetchDestination` resolution populates `#successfulHosts`.
			const successUrl = parseUrl('https://example.com/asset.png')!;
			const failUrl = parseUrl('https://example.com/missing.png')!;
			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockImplementation(
				({ url: probeUrl }) => {
					if (probeUrl.href === successUrl.href) {
						return Promise.resolve({
							url: successUrl,
							redirectPaths: [],
							isTarget: true,
							isExternal: false,
							status: 200,
							statusText: 'OK',
							contentType: 'image/png',
							contentLength: 1234,
							responseHeaders: {},
							meta: { title: '' },
							anchorList: [],
							imageList: [],
							html: '',
							isSkipped: false,
						});
					}
					return Promise.reject(new Error('getaddrinfo ENOTFOUND example.com'));
				},
			);

			const crawler = new Crawler(defaultOptions);
			const errors: CrawlerEventTypes['error'][] = [];
			crawler.on('error', (e) => {
				errors.push(e);
			});

			crawler.start([successUrl, failUrl]);

			await vi.waitFor(() => {
				expect(errors).toHaveLength(1);
			});

			// `example.com/b` failed with ENOTFOUND but the guard kept the
			// host out of the burn cache because `example.com/a` succeeded
			// earlier in this session.
			expect(dnsBurnedHostCache.has('example.com')).toBe(false);
			clearDnsBurnedHostCache();
		});

		it('still burns a host when ALL URLs on it fail (no success-guard hit)', async () => {
			// Regression test for the un-guarded burn path. When the first URL
			// on a host fails with ENOTFOUND, `#successfulHosts` is still empty
			// and `shouldBurnHost` lets the burn through. This is the original
			// behaviour (dead-domain fast-fail) that the cascade guard must
			// not regress.
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');
			const { dnsBurnedHostCache } = await import('./dns-burned-host-cache.js');
			const { clearDnsBurnedHostCache } =
				await import('./clear-dns-burned-host-cache.js');
			clearDnsBurnedHostCache();

			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockRejectedValue(
				new Error('getaddrinfo ENOTFOUND dead.invalid'),
			);

			const crawler = new Crawler(defaultOptions);
			const errors: CrawlerEventTypes['error'][] = [];
			crawler.on('error', (e) => {
				errors.push(e);
			});

			crawler.start([
				parseUrl('https://dead.invalid/a')!,
				parseUrl('https://dead.invalid/b')!,
			]);

			await vi.waitFor(() => {
				expect(errors.length).toBeGreaterThanOrEqual(1);
			});

			expect(dnsBurnedHostCache.get('dead.invalid')).toBe('dns');
			clearDnsBurnedHostCache();
		});

		it('marks the host alive when puppeteer fallback succeeds after HEAD fails (cascade guard via WAF/middlebox path)', async () => {
			// Pin the F1 contract: when HEAD dies at a middlebox / WAF
			// (parse-error / connection-reset / timeout) and the puppeteer
			// fallback succeeds, the host MUST be added to
			// `#successfulHosts` so a later DNS failure on the same host
			// does not burn it. Without this, sites whose first URL is
			// only reachable via the browser-rescue path would still be
			// vulnerable to the cascade.
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');
			const { dnsBurnedHostCache } = await import('./dns-burned-host-cache.js');
			const { clearDnsBurnedHostCache } =
				await import('./clear-dns-burned-host-cache.js');
			clearDnsBurnedHostCache();

			const fetchDestMod = await import('./fetch-destination.js');
			const fetchSpy = vi.spyOn(fetchDestMod, 'fetchDestination');
			// First URL: HEAD throws with a puppeteer-fallback-candidate
			// kind (`connection-reset`). The fallback is mocked further
			// below to return a success result, simulating the browser
			// punching through a WAF that bare HEAD/GET cannot.
			// Second URL: HEAD throws with `getaddrinfo ENOTFOUND` — the
			// cascade trigger. If the fallback success did not mark the
			// host alive, this would burn the host.
			fetchSpy.mockImplementation(({ url: probeUrl }) => {
				if (probeUrl.href === 'https://waf.example.com/page-a.html') {
					return Promise.reject(new Error('socket hang up'));
				}
				return Promise.reject(new Error('getaddrinfo ENOTFOUND waf.example.com'));
			});

			// Replace the puppeteer-launching method with a spy so we can
			// simulate a successful browser fallback without spinning up
			// Chromium. `_launchBrowserAndScrape` is the TS-private
			// (runtime-accessible) seam introduced specifically so this
			// branch of the cascade-guard contract can be unit-tested.
			vi.spyOn(
				Crawler.prototype as unknown as {
					_launchBrowserAndScrape: (...args: unknown[]) => Promise<unknown>;
				},
				'_launchBrowserAndScrape',
			).mockResolvedValue({
				type: 'success',
				pageData: {
					url: parseUrl('https://waf.example.com/page-a.html')!,
					redirectPaths: [],
					isTarget: true,
					isExternal: false,
					status: 200,
					statusText: 'OK',
					contentType: 'text/html',
					contentLength: 100,
					responseHeaders: {},
					meta: { title: '' },
					anchorList: [],
					imageList: [],
					html: '<html></html>',
					isSkipped: false,
				},
				resources: [],
				consoleLogs: [],
			});

			const crawler = new Crawler(defaultOptions);
			const errors: CrawlerEventTypes['error'][] = [];
			crawler.on('error', (e) => {
				errors.push(e);
			});

			crawler.start([
				parseUrl('https://waf.example.com/page-a.html')!,
				parseUrl('https://waf.example.com/page-b.html')!,
			]);

			await vi.waitFor(() => {
				expect(errors).toHaveLength(1);
			});

			expect(dnsBurnedHostCache.has('waf.example.com')).toBe(false);
			clearDnsBurnedHostCache();
		});

		it('marks the host alive even when the first URL returns 4xx (cascade guard is status-agnostic)', async () => {
			// Pin the F2 contract: `#successfulHosts` is populated by ANY
			// HTTP response — 4xx and 5xx still prove DNS + TCP are alive,
			// so a subsequent DNS failure must NOT burn the host. A
			// regression that gates the add on `headResult.status < 400`
			// would silently re-introduce the cascade for sites that
			// front-load 401/403/5xx (auth walls, overloaded prod).
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');
			const { dnsBurnedHostCache } = await import('./dns-burned-host-cache.js');
			const { clearDnsBurnedHostCache } =
				await import('./clear-dns-burned-host-cache.js');
			clearDnsBurnedHostCache();

			const successUrl = parseUrl('https://auth.example.com/protected.png')!;
			const failUrl = parseUrl('https://auth.example.com/missing.png')!;
			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockImplementation(
				({ url: probeUrl }) => {
					if (probeUrl.href === successUrl.href) {
						return Promise.resolve({
							url: successUrl,
							redirectPaths: [],
							isTarget: true,
							isExternal: false,
							status: 403,
							statusText: 'Forbidden',
							contentType: 'image/png',
							contentLength: 0,
							responseHeaders: {},
							meta: { title: '' },
							anchorList: [],
							imageList: [],
							html: '',
							isSkipped: false,
						});
					}
					return Promise.reject(new Error('getaddrinfo ENOTFOUND auth.example.com'));
				},
			);

			const crawler = new Crawler(defaultOptions);
			const errors: CrawlerEventTypes['error'][] = [];
			crawler.on('error', (e) => {
				errors.push(e);
			});

			crawler.start([successUrl, failUrl]);

			await vi.waitFor(() => {
				expect(errors).toHaveLength(1);
			});

			// A 403 response proves the host is reachable. The cascade
			// guard must keep `auth.example.com` out of the burn cache
			// even though the first URL did not resolve to a 2xx.
			expect(dnsBurnedHostCache.has('auth.example.com')).toBe(false);
			clearDnsBurnedHostCache();
		});

		it('marks the host alive when the first URL returns 5xx (cascade guard is status-agnostic, server-error variant)', async () => {
			// Companion of the 4xx test: 5xx is also "host alive, app
			// failed". Pinning both 4xx and 5xx surfaces protects the
			// "any HTTP response counts" contract against a regression
			// that splits the gate by error class.
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');
			const { dnsBurnedHostCache } = await import('./dns-burned-host-cache.js');
			const { clearDnsBurnedHostCache } =
				await import('./clear-dns-burned-host-cache.js');
			clearDnsBurnedHostCache();

			const successUrl = parseUrl('https://busy.example.com/overload.png')!;
			const failUrl = parseUrl('https://busy.example.com/missing.png')!;
			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockImplementation(
				({ url: probeUrl }) => {
					if (probeUrl.href === successUrl.href) {
						return Promise.resolve({
							url: successUrl,
							redirectPaths: [],
							isTarget: true,
							isExternal: false,
							status: 503,
							statusText: 'Service Unavailable',
							contentType: 'image/png',
							contentLength: 0,
							responseHeaders: {},
							meta: { title: '' },
							anchorList: [],
							imageList: [],
							html: '',
							isSkipped: false,
						});
					}
					return Promise.reject(new Error('getaddrinfo ENOTFOUND busy.example.com'));
				},
			);

			const crawler = new Crawler(defaultOptions);
			const errors: CrawlerEventTypes['error'][] = [];
			crawler.on('error', (e) => {
				errors.push(e);
			});

			crawler.start([successUrl, failUrl]);

			await vi.waitFor(() => {
				expect(errors).toHaveLength(1);
			});

			expect(dnsBurnedHostCache.has('busy.example.com')).toBe(false);
			clearDnsBurnedHostCache();
		});

		it('marks the host alive when puppeteer fallback returns `skipped` (excludeKeywords match)', async () => {
			// Companion to the success-path test above: `fallback.type ===
			// 'skipped'` (browser rendered enough to match an
			// `excludeKeywords` rule) also indicates the host is
			// responding. The host must be marked alive — otherwise a
			// site whose first URL is skipped after a browser rescue
			// would still cascade-burn on the next URL.
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');
			const { dnsBurnedHostCache } = await import('./dns-burned-host-cache.js');
			const { clearDnsBurnedHostCache } =
				await import('./clear-dns-burned-host-cache.js');
			clearDnsBurnedHostCache();

			const fetchDestMod = await import('./fetch-destination.js');
			const fetchSpy = vi.spyOn(fetchDestMod, 'fetchDestination');
			fetchSpy.mockImplementation(({ url: probeUrl }) => {
				if (probeUrl.href === 'https://waf-skip.example.com/page-a.html') {
					return Promise.reject(new Error('socket hang up'));
				}
				return Promise.reject(new Error('getaddrinfo ENOTFOUND waf-skip.example.com'));
			});

			vi.spyOn(
				Crawler.prototype as unknown as {
					_launchBrowserAndScrape: (...args: unknown[]) => Promise<unknown>;
				},
				'_launchBrowserAndScrape',
			).mockResolvedValue({
				type: 'skipped',
				resources: [],
				consoleLogs: [],
				ignored: {
					url: parseUrl('https://waf-skip.example.com/page-a.html')!,
					matchedText: 'excluded-keyword',
					excludeKeywords: ['excluded-keyword'],
				},
			});

			const crawler = new Crawler(defaultOptions);
			const errors: CrawlerEventTypes['error'][] = [];
			crawler.on('error', (e) => {
				errors.push(e);
			});

			crawler.start([
				parseUrl('https://waf-skip.example.com/page-a.html')!,
				parseUrl('https://waf-skip.example.com/page-b.html')!,
			]);

			await vi.waitFor(() => {
				expect(errors).toHaveLength(1);
			});

			expect(dnsBurnedHostCache.has('waf-skip.example.com')).toBe(false);
			clearDnsBurnedHostCache();
		});
	});

	describe('pagesScrapedOffset propagation', () => {
		it('resume() の第 4 引数 pagesScrapedOffset が deal() の header 初期表示に反映される', async () => {
			const { deal } = await import('@d-zero/dealer');
			const { default: Crawler } = await import('./crawler.js');
			vi.mocked(deal).mockResolvedValue();

			const crawler = new Crawler(defaultOptions);
			// 前回セッションで 42 件の HTML ページが scrape 済み、という想定
			crawler.resume(
				['https://example.com/pending'],
				['https://example.com/already-done'],
				[],
				42,
			);
			crawler.start([parseUrl('https://example.com/new-root')!], { recursive: true });

			await vi.waitFor(() => {
				expect(deal).toHaveBeenCalled();
			});

			// deal の 3 番目の引数（options）から header callback を取り出して、
			// 現セッション 0 件処理時点の表示を再現する
			const dealOptions = vi.mocked(deal).mock.calls[0]![2] as
				| {
						header?: (
							progress: unknown,
							done: number,
							total: number,
							limit: number,
						) => string;
				  }
				| undefined;
			expect(dealOptions?.header).toBeDefined();
			const header = dealOptions!.header!(null, 0, 0, 1);
			// resumeOffset=1 (already-done), pagesScrapedOffset=42 がそれぞれ反映される
			expect(header).toContain('1(42) done');
		});

		it('resume() の第 4 引数を省略すると pagesScrapedOffset は 0 のままになる', async () => {
			const { deal } = await import('@d-zero/dealer');
			const { default: Crawler } = await import('./crawler.js');
			vi.mocked(deal).mockResolvedValue();

			const crawler = new Crawler(defaultOptions);
			// 第 4 引数省略（既存テスト互換性）
			crawler.resume(['https://example.com/pending'], ['https://example.com/done'], []);
			crawler.start([parseUrl('https://example.com/new-root')!], { recursive: true });

			await vi.waitFor(() => {
				expect(deal).toHaveBeenCalled();
			});

			const dealOptions = vi.mocked(deal).mock.calls[0]![2] as
				| {
						header?: (
							progress: unknown,
							done: number,
							total: number,
							limit: number,
						) => string;
				  }
				| undefined;
			const header = dealOptions!.header!(null, 0, 0, 1);
			expect(header).toContain('1(0) done');
		});
	});

	describe('inventoryMode scope-build skip', () => {
		it('does NOT add seed URLs to `#scope` when inventoryMode is non-null', async () => {
			// 70k+ seed URLs in inventory mode were forming a per-host scope
			// list via `existing.some` + array spread on each iteration, which
			// is O(N²) on build and O(N) per later `findScopeEntry`. Skip the
			// scope add entirely when inventoryMode is present — the archived
			// `roots` already cover the scope semantics through the
			// constructor's seed of `#scope`. Probe via the SAME observable
			// effect a runtime `findScopeEntry` would see: a seed URL whose
			// host is NOT in the archived roots must be classified external
			// when inventoryMode is non-null, because the per-seed scope add
			// is suppressed (so its hostname never enters the scope map).
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');

			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockResolvedValue({
				url: parseUrl('https://other-host.example.com/page')!,
				redirectPaths: [],
				isTarget: true,
				isExternal: false,
				status: 200,
				statusText: 'OK',
				contentType: 'image/png',
				contentLength: 1234,
				responseHeaders: {},
				meta: { title: '' },
				anchorList: [],
				imageList: [],
				html: '',
				isSkipped: false,
			});

			const crawler = new Crawler({
				...defaultOptions,
				// `fetchExternal: false` makes the worker take the early
				// external-skip branch and emit `externalPage` immediately
				// after the scope classification, which is the most direct
				// observable that says "this URL was classified external" —
				// without needing to wire up scraping or HTTP mocks beyond
				// the trivial mock above.
				fetchExternal: false,
				// Archived roots only cover `example.com/`. The seed below is on
				// `other-host.example.com`, which would normally be added to
				// `#scope` by `start()` and treated as internal. With
				// inventoryMode != null, the scope add is skipped and the seed
				// is observed as external by `findScopeEntry`.
				inventoryMode: { seedUrls: new Set<string>() },
			});
			const externals: CrawlerEventTypes['externalPage'][] = [];
			crawler.on('externalPage', (p) => {
				externals.push(p);
			});

			crawler.start([parseUrl('https://other-host.example.com/page')!]);

			await vi.waitFor(() => {
				// External classification routes through the `externalPage`
				// emit path (`Crawler.ts:900-916`), confirming the seed was
				// NOT added to `#scope`.
				expect(externals).toHaveLength(1);
			});
		});

		it('skips scope-add whenever inventoryMode is non-null, regardless of seedUrls contents', async () => {
			// F10: the existing skip test seeds an EMPTY `seedUrls`,
			// which leaves the door open for a future regression where
			// the skip condition is tightened to e.g.
			// `inventoryMode?.seedUrls?.size > 0` and would silently
			// continue passing. Run the same scope-skip observation with
			// a NON-empty seedUrls to discriminate: the skip must fire
			// regardless of whether the seed set is populated. Together
			// with the empty-seed variant above, this pins the gate as
			// "`inventoryMode != null` alone", not any deeper field.
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');

			const seedUrl = parseUrl('https://other-host.example.com/page')!;
			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockResolvedValue({
				url: seedUrl,
				redirectPaths: [],
				isTarget: true,
				isExternal: false,
				status: 200,
				statusText: 'OK',
				contentType: 'image/png',
				contentLength: 1234,
				responseHeaders: {},
				meta: { title: '' },
				anchorList: [],
				imageList: [],
				html: '',
				isSkipped: false,
			});

			const crawler = new Crawler({
				...defaultOptions,
				fetchExternal: false,
				// Non-empty seedUrls — the gate must still fire on
				// `inventoryMode != null` rather than peeking inside
				// the object.
				inventoryMode: { seedUrls: new Set([seedUrl.withoutHashAndAuth]) },
			});
			const externals: CrawlerEventTypes['externalPage'][] = [];
			crawler.on('externalPage', (p) => {
				externals.push(p);
			});

			crawler.start([seedUrl]);

			await vi.waitFor(() => {
				expect(externals).toHaveLength(1);
			});
		});

		it('adds seed URLs to `#scope` as usual when inventoryMode is null (regression guard)', async () => {
			// The skip must be conditional. Outside inventory mode the seeds
			// are the entire scope definition — drop the scope-add and every
			// internal URL becomes external. Mirror the inventoryMode test
			// observation channel (`externalPage` emit under
			// `fetchExternal: false`) so the assertions read symmetrically:
			// without inventoryMode, seed-on-arbitrary-host is treated as
			// internal and the early external-skip emit does NOT fire.
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');

			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockResolvedValue({
				url: parseUrl('https://other-host.example.com/page')!,
				redirectPaths: [],
				isTarget: true,
				isExternal: false,
				status: 200,
				statusText: 'OK',
				contentType: 'image/png',
				contentLength: 1234,
				responseHeaders: {},
				meta: { title: '' },
				anchorList: [],
				imageList: [],
				html: '',
				isSkipped: false,
			});

			const crawler = new Crawler({
				...defaultOptions,
				fetchExternal: false,
				// No inventoryMode — seeds register themselves into `#scope`.
			});
			const externals: CrawlerEventTypes['externalPage'][] = [];
			crawler.on('externalPage', (p) => {
				externals.push(p);
			});
			// Wait for the worker to complete via the `page` event so the
			// assertion below sees the post-processing state. Without
			// inventoryMode, the seed adds its hostname to `#scope` and the
			// worker treats it as internal, emitting `page` (not
			// `externalPage`).
			const pages: CrawlerEventTypes['page'][] = [];
			crawler.on('page', (p) => {
				pages.push(p);
			});

			crawler.start([parseUrl('https://other-host.example.com/page')!]);

			await vi.waitFor(() => {
				expect(pages).toHaveLength(1);
			});
			expect(externals).toHaveLength(0);
		});
	});

	describe('sub-resource lineage propagation', () => {
		// Repro for the bug surfaced during dogfooding: in `--resume` /
		// `--retry-failed` mode `inventoryMode` is `null` (it is not
		// persisted across sessions), and the previous implementation
		// computed the sub-resource `source` from `inventoryMode` alone.
		// That made every sub-resource captured during the re-render of an
		// inventory-labelled page fall back to the DB DEFAULT `'crawled'`,
		// losing the `'inventory-discovered'` provenance.
		//
		// The fix injects a `lookupPageSource` callback so the Crawler can
		// resolve the parent's stored source. These tests pin the wire-up
		// from both directions:
		//
		// - resume mode (inventoryMode = null, callback returns
		//   `inventory-seed`) → response emit carries `inventory-discovered`
		// - resume mode + crawled parent → emit carries `undefined` (default)
		// - inventory mode (inventoryMode != null) → emit carries
		//   `inventory-discovered` WITHOUT touching the callback
		//
		// The crawler is driven with a sub-resource response by mocking
		// `#launchBrowserAndScrape` indirectly: a deep mock of the puppeteer
		// stack would balloon the test surface, so we instead reach into
		// the public `#handleResources` path via the existing dealer-driven
		// scrape and read back the emitted `response` payload.
		it('emits `response` with `source === "inventory-discovered"` when the parent is `inventory-seed` (resume path, end-to-end pin)', async () => {
			// F6: previous shape only asserted that `lookupPageSource` was
			// called — never that an emitted `response.source` actually
			// carried `'inventory-discovered'`. This test drives a real
			// scrape that yields a sub-resource (via the
			// `_launchBrowserAndScrape` spy) and asserts the emit's
			// `source` matches the parent's lineage. A mutation that
			// breaks the wire-up between `#resolveParentSource` and
			// `#handleResources` (e.g. always passing `undefined` to
			// `planSubResourceEmits`) is caught here.
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');

			const url = parseUrl('https://example.com/seed-page.html')!;
			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockResolvedValue({
				url,
				redirectPaths: [],
				isTarget: true,
				isExternal: false,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				meta: { title: '' },
				anchorList: [],
				imageList: [],
				html: '',
				isSkipped: false,
			});

			const subResourceUrl = parseUrl('https://example.com/style.css')!;
			vi.spyOn(
				Crawler.prototype as unknown as {
					_launchBrowserAndScrape: (...args: unknown[]) => Promise<unknown>;
				},
				'_launchBrowserAndScrape',
			).mockResolvedValue({
				type: 'success',
				pageData: {
					url,
					redirectPaths: [],
					isTarget: true,
					isExternal: false,
					status: 200,
					statusText: 'OK',
					contentType: 'text/html',
					contentLength: 100,
					responseHeaders: {},
					meta: { title: '' },
					anchorList: [],
					imageList: [],
					html: '<html></html>',
					isSkipped: false,
				},
				resources: [
					{
						log: {},
						resource: {
							url: subResourceUrl,
							isExternal: false,
							isError: false,
							status: 200,
							statusText: 'OK',
							contentType: 'text/css',
							contentLength: 0,
							compress: false,
							cdn: false,
							headers: null,
						},
						pageUrl: url.withoutHash,
					},
				],
				consoleLogs: [],
			});

			const lookupPageSource = vi.fn(() => Promise.resolve('inventory-seed' as const));
			const crawler = new Crawler({
				...defaultOptions,
				// `inventoryMode: null` — emulate `--resume` / `--retry-failed`
				// session where the seed set is not in memory and the DB
				// callback is the only source of truth for parent lineage.
				lookupPageSource,
			});

			const responses: CrawlerEventTypes['response'][] = [];
			crawler.on('response', (r) => {
				responses.push(r);
			});

			crawler.start([url]);

			await vi.waitFor(() => {
				expect(responses).toHaveLength(1);
			});

			expect(responses[0]!.source).toBe('inventory-discovered');
			expect(lookupPageSource).toHaveBeenCalledWith(url.withoutHashAndAuth);
		});

		it('emits `response` with `source === undefined` when the parent is `crawled` (resume path, regression guard)', async () => {
			// Symmetric counter-test: a crawled parent must NOT promote
			// its sub-resources to `'inventory-discovered'`. The DB
			// DEFAULT `'crawled'` applies, so the emit carries
			// `undefined` and the orchestrator's setResources call
			// omits the source column from the INSERT.
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');

			const url = parseUrl('https://example.com/crawled-page.html')!;
			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockResolvedValue({
				url,
				redirectPaths: [],
				isTarget: true,
				isExternal: false,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				meta: { title: '' },
				anchorList: [],
				imageList: [],
				html: '',
				isSkipped: false,
			});

			const subResourceUrl = parseUrl('https://example.com/app.js')!;
			vi.spyOn(
				Crawler.prototype as unknown as {
					_launchBrowserAndScrape: (...args: unknown[]) => Promise<unknown>;
				},
				'_launchBrowserAndScrape',
			).mockResolvedValue({
				type: 'success',
				pageData: {
					url,
					redirectPaths: [],
					isTarget: true,
					isExternal: false,
					status: 200,
					statusText: 'OK',
					contentType: 'text/html',
					contentLength: 100,
					responseHeaders: {},
					meta: { title: '' },
					anchorList: [],
					imageList: [],
					html: '<html></html>',
					isSkipped: false,
				},
				resources: [
					{
						log: {},
						resource: {
							url: subResourceUrl,
							isExternal: false,
							isError: false,
							status: 200,
							statusText: 'OK',
							contentType: 'application/javascript',
							contentLength: 0,
							compress: false,
							cdn: false,
							headers: null,
						},
						pageUrl: url.withoutHash,
					},
				],
				consoleLogs: [],
			});

			const crawler = new Crawler({
				...defaultOptions,
				lookupPageSource: () => Promise.resolve('crawled' as const),
			});

			const responses: CrawlerEventTypes['response'][] = [];
			crawler.on('response', (r) => {
				responses.push(r);
			});

			crawler.start([url]);

			await vi.waitFor(() => {
				expect(responses).toHaveLength(1);
			});

			expect(responses[0]!.source).toBeUndefined();
		});

		it('skips the page-source lookup when inventoryMode is active', async () => {
			// In a live `--inventory` session the seed set is in memory, so
			// the in-memory `derivePageSource` answer dominates and the
			// `lookupPageSource` callback must NOT be called — keeping the
			// hot path free of an unnecessary DB round-trip per page.
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');

			const url = parseUrl('https://example.com/listed-seed.html')!;
			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockResolvedValue({
				url,
				redirectPaths: [],
				isTarget: true,
				isExternal: false,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				meta: { title: '' },
				anchorList: [],
				imageList: [],
				html: '',
				isSkipped: false,
			});

			// Drive a real sub-resource emit through the puppeteer-spy
			// path so the assertion below pins the COMPLETE wire-up: in
			// inventory mode the `derivePageSource` short-circuit
			// resolves the parent source from the seed set AND the
			// emit carries `'inventory-discovered'`. An emit-free
			// version of this test would still pass after a regression
			// where `#handleResources` is bypassed entirely.
			const subResourceUrl = parseUrl('https://example.com/seed-style.css')!;
			vi.spyOn(
				Crawler.prototype as unknown as {
					_launchBrowserAndScrape: (...args: unknown[]) => Promise<unknown>;
				},
				'_launchBrowserAndScrape',
			).mockResolvedValue({
				type: 'success',
				pageData: {
					url,
					redirectPaths: [],
					isTarget: true,
					isExternal: false,
					status: 200,
					statusText: 'OK',
					contentType: 'text/html',
					contentLength: 100,
					responseHeaders: {},
					meta: { title: '' },
					anchorList: [],
					imageList: [],
					html: '<html></html>',
					isSkipped: false,
				},
				resources: [
					{
						log: {},
						resource: {
							url: subResourceUrl,
							isExternal: false,
							isError: false,
							status: 200,
							statusText: 'OK',
							contentType: 'text/css',
							contentLength: 0,
							compress: false,
							cdn: false,
							headers: null,
						},
						pageUrl: url.withoutHash,
					},
				],
				consoleLogs: [],
			});

			const lookupPageSource = vi.fn(() => Promise.resolve());
			const crawler = new Crawler({
				...defaultOptions,
				inventoryMode: { seedUrls: new Set([url.withoutHashAndAuth]) },
				lookupPageSource,
			});

			const responses: CrawlerEventTypes['response'][] = [];
			crawler.on('response', (r) => {
				responses.push(r);
			});

			crawler.start([url]);

			await vi.waitFor(() => {
				expect(responses).toHaveLength(1);
			});

			// Two assertions in one to pin both halves of the
			// inventory-mode contract:
			//   1. Sub-resource emit carries `'inventory-discovered'`
			//      — the seed-set match propagates correctly.
			//   2. `lookupPageSource` is NOT called — the in-memory
			//      `derivePageSource` short-circuits the lookup, keeping
			//      the hot path free of an unnecessary DB round-trip per
			//      page in a live `--inventory` session.
			expect(responses[0]!.source).toBe('inventory-discovered');
			expect(lookupPageSource).not.toHaveBeenCalled();
		});
	});

	describe('console log capture', () => {
		it('emits `consoleLogs` with the page URL and redirect chain when entries are captured', async () => {
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');

			const url = parseUrl('https://example.com/logged-page.html')!;
			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockResolvedValue({
				url,
				redirectPaths: [],
				isTarget: true,
				isExternal: false,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				meta: { title: '' },
				anchorList: [],
				imageList: [],
				html: '',
				isSkipped: false,
			});

			vi.spyOn(
				Crawler.prototype as unknown as {
					_launchBrowserAndScrape: (...args: unknown[]) => Promise<unknown>;
				},
				'_launchBrowserAndScrape',
			).mockResolvedValue({
				type: 'success',
				pageData: {
					url,
					redirectPaths: ['https://example.com/old-page.html'],
					isTarget: true,
					isExternal: false,
					status: 200,
					statusText: 'OK',
					contentType: 'text/html',
					contentLength: 100,
					responseHeaders: {},
					meta: { title: '' },
					anchorList: [],
					imageList: [],
					html: '<html></html>',
					isSkipped: false,
				},
				resources: [],
				consoleLogs: [
					{
						pageUrl: url.withoutHash,
						type: 'error',
						text: 'boom',
						args: [],
						ts: 1000,
					},
				],
			});

			const crawler = new Crawler(defaultOptions);
			const consoleLogs: CrawlerEventTypes['consoleLogs'][] = [];
			crawler.on('consoleLogs', (payload) => {
				consoleLogs.push(payload);
			});

			crawler.start([url]);

			await vi.waitFor(() => {
				expect(consoleLogs).toHaveLength(1);
			});

			expect(consoleLogs[0]!.pageUrl).toBe(url.withoutHashAndAuth);
			expect(consoleLogs[0]!.redirectPaths).toEqual([
				'https://example.com/old-page.html',
			]);
			expect(consoleLogs[0]!.entries).toHaveLength(1);
			expect(consoleLogs[0]!.entries[0]!.text).toBe('boom');
		});

		it('does not emit `consoleLogs` when the scrape captured no entries', async () => {
			await driveDeal();
			const { default: Crawler } = await import('./crawler.js');

			const url = parseUrl('https://example.com/silent-page.html')!;
			const fetchDestMod = await import('./fetch-destination.js');
			vi.spyOn(fetchDestMod, 'fetchDestination').mockResolvedValue({
				url,
				redirectPaths: [],
				isTarget: true,
				isExternal: false,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				meta: { title: '' },
				anchorList: [],
				imageList: [],
				html: '',
				isSkipped: false,
			});

			vi.spyOn(
				Crawler.prototype as unknown as {
					_launchBrowserAndScrape: (...args: unknown[]) => Promise<unknown>;
				},
				'_launchBrowserAndScrape',
			).mockResolvedValue({
				type: 'success',
				pageData: {
					url,
					redirectPaths: [],
					isTarget: true,
					isExternal: false,
					status: 200,
					statusText: 'OK',
					contentType: 'text/html',
					contentLength: 100,
					responseHeaders: {},
					meta: { title: '' },
					anchorList: [],
					imageList: [],
					html: '<html></html>',
					isSkipped: false,
				},
				resources: [],
				consoleLogs: [],
			});

			const crawler = new Crawler(defaultOptions);
			const consoleLogs: CrawlerEventTypes['consoleLogs'][] = [];
			crawler.on('consoleLogs', (payload) => {
				consoleLogs.push(payload);
			});
			const pages: CrawlerEventTypes['page'][] = [];
			crawler.on('page', (payload) => {
				pages.push(payload);
			});

			crawler.start([url]);

			await vi.waitFor(() => {
				expect(pages).toHaveLength(1);
			});

			expect(consoleLogs).toHaveLength(0);
		});
	});
});
