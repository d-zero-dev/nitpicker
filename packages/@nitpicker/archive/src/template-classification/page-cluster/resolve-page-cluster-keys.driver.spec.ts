import type { PageClusterPage, ProgressEvent } from './types.js';
import type { TemplatePageHtml, TemplatePageSignals } from '@nitpicker/core/types';

import { beforeEach, describe, expect, test, vi } from 'vitest';

import { resolvePageClusterKeys } from './resolve-page-cluster-keys.js';

/**
 * What the stand-in run saw, and what it answers: the driver's batching,
 * ordering and failure handling are checked against a run whose calls the
 * test controls, so the native addon's own behavior does not enter.
 */
const fake = vi.hoisted(() => ({
	/** Answers of `pageMask()`, one per read; the last repeats. */
	masks: [] as Uint8Array[],
	/** Events in the order they happened: `push:start`, `push:settle`, `cancel`. */
	log: [] as string[],
	/** Page count of every `pushPages` call. */
	pushedBatches: [] as TemplatePageHtml[][],
	/** Signal count of every `pushSignals` call. */
	signalBatches: [] as number[],
	/** When set, every `pushPages` call rejects with it once it settles. */
	pushError: undefined as Error | undefined,
	/** Options of every `createTemplateClassificationRun` call. */
	runOptions: [] as Record<string, unknown>[],
}));

vi.mock('@nitpicker/core/create-template-classification-run', () => ({
	createTemplateClassificationRun: (options: Record<string, unknown>) => {
		fake.runOptions.push(options);
		let maskReads = 0;
		return {
			pushSignals: (signals: readonly TemplatePageSignals[]) => {
				fake.signalBatches.push(signals.length);
			},
			block: () => Promise.resolve(),
			pageMask: () => fake.masks[Math.min(maskReads++, fake.masks.length - 1)]!,
			pushPages: async (pages: TemplatePageHtml[]) => {
				fake.log.push('push:start');
				fake.pushedBatches.push(pages);
				// A call that outlives the driver's next awaits, so a failure
				// meets it still running.
				await new Promise((resolve) => setTimeout(resolve, 10));
				fake.log.push('push:settle');
				if (fake.pushError) throw fake.pushError;
			},
			finishPages: () => Promise.resolve(),
			needsAssignment: () => false,
			pushAssignmentPages: () => Promise.resolve(),
			takeOutput: () =>
				Promise.resolve({
					keys: [],
					keyOfPage: new Uint32Array(0),
					reasons: new Map(),
					sampledBlocks: [
						{
							blockKey: 'path:p',
							pageCount: 3,
							pairBytes: 24,
							reason: 'table-over-budget',
						},
					],
				}),
			cancel: () => {
				fake.log.push('cancel');
			},
		};
	},
}));

/**
 * A mask of `length` pages, every one used.
 * @param length
 */
function allUsed(length: number): Uint8Array {
	return new Uint8Array(length).fill(1);
}

/**
 * `count` pages whose HTML is `html(index)`.
 * @param count
 * @param html
 */
function pagesOf(count: number, html: (index: number) => string): PageClusterPage[] {
	return Array.from({ length: count }, (_, index) => ({
		paths: ['p', String(index)],
		stylesheetHrefs: [],
		getHtml: () => html(index),
	}));
}

/**
 * The page count of every pushed batch.
 */
function batchSizes(): number[] {
	return fake.pushedBatches.map((batch) => batch.length);
}

describe('resolvePageClusterKeys driver', () => {
	beforeEach(() => {
		fake.masks = [];
		fake.log = [];
		fake.pushedBatches = [];
		fake.signalBatches = [];
		fake.pushError = undefined;
		fake.runOptions = [];
	});

	describe('the memory budget', () => {
		test('is handed to the run when given, zero included', async () => {
			fake.masks = [allUsed(0)];
			await resolvePageClusterKeys(() => [], { memoryBudget: 0 });
			await resolvePageClusterKeys(() => [], { memoryBudget: 1024 });

			expect(fake.runOptions).toEqual([{ memoryBudget: 0 }, { memoryBudget: 1024 }]);
		});

		test('is left to the run default when omitted', async () => {
			fake.masks = [allUsed(0)];
			await resolvePageClusterKeys(() => []);

			expect(fake.runOptions).toStrictEqual([{}]);
		});

		test('returns the blocks the run sampled', async () => {
			fake.masks = [allUsed(0)];
			const { sampledBlocks } = await resolvePageClusterKeys(() => []);

			expect(sampledBlocks).toEqual([
				{ blockKey: 'path:p', pageCount: 3, pairBytes: 24, reason: 'table-over-budget' },
			]);
		});
	});

	describe('reading the HTML ahead', () => {
		test('hands pages over in corpus order however their reads finish', async () => {
			// Later pages finish reading first.
			const pages = Array.from({ length: 20 }, (_, index) => ({
				paths: ['p', String(index)],
				stylesheetHrefs: [],
				getHtml: () =>
					new Promise<string>((resolve) =>
						setTimeout(() => resolve(`<p>${index}</p>`), 20 - index),
					),
			}));
			fake.masks = [allUsed(20)];
			await resolvePageClusterKeys(() => pages);
			expect(fake.pushedBatches.flat().map((page) => page.html)).toEqual([
				'<p>0</p>',
				'<p>1</p>',
				'<p>2</p>',
				'<p>3</p>',
				'<p>4</p>',
				'<p>5</p>',
				'<p>6</p>',
				'<p>7</p>',
				'<p>8</p>',
				'<p>9</p>',
				'<p>10</p>',
				'<p>11</p>',
				'<p>12</p>',
				'<p>13</p>',
				'<p>14</p>',
				'<p>15</p>',
				'<p>16</p>',
				'<p>17</p>',
				'<p>18</p>',
				'<p>19</p>',
			]);
		});

		test('reads at most 17 pages at once: the one taken next and 16 ahead', async () => {
			let reading = 0;
			let mostAtOnce = 0;
			const pages = Array.from({ length: 100 }, (_, index) => ({
				paths: ['p', String(index)],
				stylesheetHrefs: [],
				getHtml: async () => {
					reading++;
					mostAtOnce = Math.max(mostAtOnce, reading);
					await new Promise((resolve) => setTimeout(resolve, 1));
					reading--;
					return '<body></body>';
				},
			}));
			fake.masks = [allUsed(100)];
			await resolvePageClusterKeys(() => pages);
			expect(mostAtOnce).toBe(17);
		});
	});

	test('stops reading and cancels when a push fails', async () => {
		const failure = new Error('native push failed');
		fake.pushError = failure;
		let reads = 0;
		const pages = Array.from({ length: 2000 }, (_, index) => ({
			paths: ['p', String(index)],
			stylesheetHrefs: [],
			getHtml: async () => {
				reads++;
				await new Promise((resolve) => setTimeout(resolve, 1));
				return '<body></body>';
			},
		}));
		fake.masks = [allUsed(2000)];
		await expect(resolvePageClusterKeys(() => pages)).rejects.toBe(failure);
		expect(fake.log).toEqual(['push:start', 'push:settle', 'cancel']);
		// The failure is noticed while the next batch is read, long before
		// the corpus ends.
		expect(reads).toBeLessThan(2000);
	});

	describe('failure while a push is in flight', () => {
		test('cancels once, after the push settled, when getHtml rejects', async () => {
			const failure = new Error('html read failed');
			const pages = pagesOf(65, () => '<body></body>');
			pages[64] = { ...pages[64]!, getHtml: () => Promise.reject(failure) };
			fake.masks = [allUsed(65)];
			await expect(resolvePageClusterKeys(() => pages)).rejects.toBe(failure);
			expect(fake.log).toEqual(['push:start', 'push:settle', 'cancel']);
		});

		// The HTML of 16 pages is read ahead, so the first batch of 64 is pushed
		// once 80 pages have been read: the failures below come after that.
		test('cancels once, after the push settled, when the factory yields more pages than the first read', async () => {
			const pages = pagesOf(81, () => '<body></body>');
			fake.masks = [allUsed(80)];
			await expect(resolvePageClusterKeys(() => pages)).rejects.toThrow(
				'produced more than 80 pages but the first read saw 80',
			);
			expect(fake.log).toEqual(['push:start', 'push:settle', 'cancel']);
		});

		test('cancels once, after the push settled, when the factory yields fewer pages than the first read', async () => {
			const pages = pagesOf(64, () => '<body></body>');
			fake.masks = [allUsed(65)];
			await expect(resolvePageClusterKeys(() => pages)).rejects.toThrow(
				'produced 64 pages but the first read saw 65',
			);
			expect(fake.log).toEqual(['push:start', 'push:settle', 'cancel']);
		});

		test('cancels once, after the push settled, when the factory throws midway', async () => {
			const failure = new Error('archive read failed');
			const pages = pagesOf(80, () => '<body></body>');
			let reads = 0;
			/**
			 * @yields {PageClusterPage} The 80 pages, then throws.
			 */
			function* failing(): Generator<PageClusterPage> {
				yield* pages;
				throw failure;
			}
			fake.masks = [allUsed(81)];
			await expect(
				resolvePageClusterKeys(() => (++reads === 1 ? pages : failing())),
			).rejects.toBe(failure);
			expect(fake.log).toEqual(['push:start', 'push:settle', 'cancel']);
		});
	});

	describe('batching', () => {
		test('flushes a batch once its HTML reaches 32 MiB in UTF-16 units', async () => {
			// Five pages of 16 MiB: two reach the limit, so the batches are 2, 2, 1.
			const html = 'x'.repeat(16 * 1024 * 1024);
			fake.masks = [allUsed(5)];
			await resolvePageClusterKeys(() => pagesOf(5, () => html));
			expect(batchSizes()).toEqual([2, 2, 1]);
		});

		test('flushes a batch holding one page larger than 32 MiB at once', async () => {
			const big = 'x'.repeat(33 * 1024 * 1024);
			fake.masks = [allUsed(3)];
			await resolvePageClusterKeys(() =>
				pagesOf(3, (index) => (index === 1 ? big : '<p></p>')),
			);
			expect(batchSizes()).toEqual([2, 1]);
		});

		test('counts only the pages a read uses toward the 64-page batch, sending the others as empty HTML', async () => {
			// 200 pages of which the even ones are used: the 64th used page is
			// index 126, so the first batch holds indexes 0 to 126 and the second
			// the remaining 36 used ones with the unused pages between them.
			const mask = Uint8Array.from({ length: 200 }, (_, index) =>
				index % 2 === 0 ? 1 : 0,
			);
			fake.masks = [mask];
			let htmlReads = 0;
			const pages = pagesOf(200, (index) => {
				htmlReads++;
				return `<p>${index}</p>`;
			});
			await resolvePageClusterKeys(() => pages);
			expect(batchSizes()).toEqual([127, 73]);
			expect(htmlReads).toBe(100);
			expect(fake.pushedBatches[0]!.slice(0, 3)).toEqual([
				{ html: '<p>0</p>' },
				{ html: '' },
				{ html: '<p>2</p>' },
			]);
		});
	});

	describe('progress', () => {
		test('reports pass0-signals at 1,000 and 2,000 pages seen of 2,500', async () => {
			fake.masks = [new Uint8Array(2500)];
			const events: ProgressEvent[] = [];
			await resolvePageClusterKeys(() => pagesOf(2500, () => ''), {
				onProgress: (event) => events.push(event),
			});
			expect(events).toEqual([
				{ phase: 'pass0-signals', pagesSeen: 1000 },
				{ phase: 'pass0-signals', pagesSeen: 2000 },
			]);
			expect(fake.signalBatches).toEqual([1000, 1000, 500]);
		});
	});
});
