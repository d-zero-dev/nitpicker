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
 * Default crawler options for testing.
 */
const defaultOptions = {
	interval: 0,
	parallels: 1,
	recursive: true,
	scope: ['https://example.com/'],
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
			crawler.start(url);

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

			crawler.start(parseUrl('https://example.com/')!);

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

			crawler.start(parseUrl('https://example.com/')!);

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

			crawler.start(parseUrl('https://example.com/')!);

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
			crawler.startMultiple(urls);

			await vi.waitFor(() => {
				expect(errors).toHaveLength(3);
			});

			expect(errors[0]!.url).toBe('https://example.com/page1');
			expect(errors[0]!.error.message).toBe('err-a');
			expect(errors[1]!.error.message).toBe('err-b');
			expect(errors[2]!.error.message).toBe('err-c');
		});
	});

	describe('worker-level error handling', () => {
		it('ワーカー内の例外が error イベントとして emit され処理が継続する', async () => {
			const { deal } = await import('@d-zero/dealer');
			const { default: Crawler } = await import('./crawler.js');

			const workerError = new Error('unexpected crash');

			// Simulate deal: call setup function, then invoke the returned work function
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

			crawler.start(parseUrl('https://example.com/')!);

			await vi.waitFor(() => {
				expect(crawlEndEmitted).toBe(true);
			});

			expect(errors).toHaveLength(1);
			expect(errors[0]!.error.message).toBe('unexpected crash');
			expect(errors[0]!.url).toBe('https://example.com');
		});
	});
});
