import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createHtmlSelectorFixtureArchive } from '../test-helpers/create-html-selector-fixture-archive.js';

import { scanHtmlSnapshots } from './scan-html-snapshots.js';

// Two snapshots per read chunk and one snapshot per judged batch: five
// snapshots are three chunks (2 + 2 + 1) and five batches, so an abort in the
// first batch leaves chunks the scan must refuse to start.
vi.mock('./scan-chunk.js', () => ({ SCAN_CHUNK: 2 }));
vi.mock('./scan-batch-bytes.js', () => ({ SCAN_BATCH_BYTES: 1 }));

const workingDir = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	'__test_fixtures_scan_html_snapshots_signal__',
);

describe('scanHtmlSnapshots with a signal', () => {
	let archive: Awaited<ReturnType<typeof createHtmlSelectorFixtureArchive>>;

	beforeAll(async () => {
		archive = await createHtmlSelectorFixtureArchive({
			workingDir,
			fileName: 'scan-signal.nitpicker',
			pages: [1, 2, 3, 4, 5].map((n) => ({
				url: `https://example.com/${n}`,
				html: `<p>${n}</p>`,
			})),
		});
	});

	afterAll(async () => {
		await archive?.close();
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('rejects with the signal reason without judging anything when it is already aborted', async () => {
		const reason = new Error('aborted first');
		const judgeBatch = vi.fn((batch: readonly unknown[]) =>
			Promise.resolve(batch.map(() => false)),
		);
		await expect(
			scanHtmlSnapshots({
				knex: archive.getKnex(),
				judgeBatch,
				signal: AbortSignal.abort(reason),
			}),
		).rejects.toBe(reason);
		expect(judgeBatch).not.toHaveBeenCalled();
	});

	it('stops before the next chunk when the signal aborts while a batch is judged', async () => {
		const controller = new AbortController();
		const reason = new Error('client went away');
		let judged = 0;
		await expect(
			scanHtmlSnapshots({
				knex: archive.getKnex(),
				judgeBatch: (batch) => {
					judged += batch.length;
					controller.abort(reason);
					return Promise.resolve(batch.map(() => false));
				},
				signal: controller.signal,
			}),
		).rejects.toBe(reason);
		// The first chunk (two snapshots, one batch each) was already being judged.
		expect(judged).toBeGreaterThan(0);
		expect(judged).toBeLessThan(5);
	});

	it('does not reject while the next chunk is still being read from the archive', async () => {
		// Every blob read is held back, so one is still in flight when the scan
		// notices the abort; a caller that closes the archive on rejection must
		// not find a query still running.
		let inFlight = 0;
		/**
		 * Wraps a query builder so that awaiting it starts the query 80 ms late and
		 * counts it as in flight until it settles. Chained calls keep the wrapper.
		 * @param builder - The query builder of one blob read.
		 */
		const holdBack = (builder: PromiseLike<unknown>): PromiseLike<unknown> => {
			const wrapper: PromiseLike<unknown> = new Proxy(builder, {
				get(target, property) {
					if (property === 'then') {
						return (onFulfilled: never, onRejected: never) => {
							inFlight++;
							return new Promise((resolve) => setTimeout(resolve, 80))
								.then(() => target.then(onFulfilled, onRejected))
								.finally(() => {
									inFlight--;
								});
						};
					}
					const member = Reflect.get(target, property) as unknown;
					if (typeof member !== 'function') {
						return member;
					}
					return (...callArguments: unknown[]) => {
						const result = Reflect.apply(member, target, callArguments) as unknown;
						return result === target ? wrapper : result;
					};
				},
			});
			return wrapper;
		};
		const knex = new Proxy(archive.getKnex(), {
			apply(target, thisArg, args: [string]) {
				const builder = Reflect.apply(target, thisArg, args) as PromiseLike<unknown>;
				if (args[0] !== 'page_html_blobs') {
					return builder;
				}
				return holdBack(builder);
			},
		});
		const controller = new AbortController();
		await expect(
			scanHtmlSnapshots({
				knex,
				judgeBatch: (batch) => {
					controller.abort(new Error('client went away'));
					return Promise.resolve(batch.map(() => false));
				},
				signal: controller.signal,
			}),
		).rejects.toThrow('client went away');
		expect(inFlight).toBe(0);
	});

	it('scans every snapshot when the signal never fires', async () => {
		let judged = 0;
		const result = await scanHtmlSnapshots({
			knex: archive.getKnex(),
			judgeBatch: (batch) => {
				judged += batch.length;
				return Promise.resolve(batch.map(() => true));
			},
			signal: new AbortController().signal,
		});
		expect(judged).toBe(5);
		expect(result.matchedPages).toHaveLength(5);
	});
});
