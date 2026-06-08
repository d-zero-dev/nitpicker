import type { CrawlerEventTypes } from './types.js';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@d-zero/dealer', () => ({
	deal: vi.fn(),
}));

vi.mock('@d-zero/shared/retry', () => ({
	/**
	 * Stub retryCall that calls the function once without retries.
	 * @param fn - The function to call.
	 * @returns The result of calling fn.
	 */
	retryCall: (fn: () => unknown) => fn(),
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
 */
async function driveDeal() {
	const { deal } = await import('@d-zero/dealer');
	vi.mocked(deal).mockImplementation(async (items, factory) => {
		for (const [index, item] of (items as unknown[]).entries()) {
			const noop = () => {};
			const noopAsync = async () => {};
			// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- deal factory signature is complex; cast is intentional in test
			const workFn = (factory as Function)(item, noop, index, noop, noopAsync) as
				| (() => Promise<void>)
				| undefined;
			if (workFn) {
				await workFn();
			}
		}
	});
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
});
