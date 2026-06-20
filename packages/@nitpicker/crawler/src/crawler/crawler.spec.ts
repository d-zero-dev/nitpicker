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
});
