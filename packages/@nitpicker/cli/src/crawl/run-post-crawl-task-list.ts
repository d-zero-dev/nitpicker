import type { StepContext } from '@d-zero/dealer';
import type { CrawlerOrchestrator } from '@nitpicker/crawler';

import { TaskList } from '@d-zero/dealer';

import { createByteProgressLogger } from '../create-byte-progress-logger.js';
import { WRITE_STEP_LABELS } from '../write-step-labels.js';

import { createVerboseTimestampStream } from './create-verbose-timestamp-stream.js';
import { ensureViewerReadModelQuietly } from './ensure-viewer-read-model-quietly.js';
import { scanJsResourcesQuietly } from './scan-js-resources-quietly.js';

/** Options controlling {@link runPostCrawlTaskList}'s display and scope. */
export interface RunPostCrawlTaskListOptions {
	/** Passed straight to `TaskList.run()`; also timestamps the render stream. */
	readonly verbose: boolean;
	/** When `true`, none of the three steps render — mirrors the crawl command's own `--silent`. */
	readonly silent: boolean;
	/** When `true`, the `'Scan JS resources'` row is never built — mirrors `--skip-technology-js-scan`. */
	readonly skipTechnologyJsScan: boolean;
	/** Render target. Defaults to `process.stderr`; overridable for tests. */
	readonly stream?: NodeJS.WritableStream;
}

/**
 * Runs the sequential post-crawl pipeline every `crawl` mode function
 * shares — `scanJsResourcesQuietly` → `ensureViewerReadModelQuietly` →
 * `orchestrator.write()` — as a `TaskList`: one row per step, `[ ]` →
 * `[%taskSpin%]` → `done`/`error` in order.
 *
 * Deliberately separate from the crawl's own display (`attach-crawl-display.ts`):
 * the crawl body is driven by `@nitpicker/crawler`'s internal `deal()` call,
 * a parallel worker pool with its own `Lanes`-based rendering that a
 * sequential `TaskList` cannot represent. This task list only starts once
 * the caller's `await using orchestrator = await CrawlerOrchestrator.*(...)`
 * has resolved — i.e. after the crawl body's own `Lanes` has already closed
 * — so the two never render at once.
 *
 * The `'Write archive'` row subscribes to `orchestrator`'s `writeStep` /
 * `writeTarProgress` events for the duration of `orchestrator.write()` —
 * `attach-crawl-display.ts` deliberately does not relay these, since they
 * only fire from this later call. `TypedAwaitEventEmitter` has no `off()`,
 * but that's fine here: `orchestrator` is disposed (`await using`) by the
 * caller right after this function returns, so the listeners have nothing
 * left to fire on.
 * @param orchestrator - The orchestrator returned by a completed crawl.
 * @param options - See {@link RunPostCrawlTaskListOptions}.
 * @example
 * ```ts
 * await using orchestrator = await CrawlerOrchestrator.resume(stubPath, options, callback);
 * await runPostCrawlTaskList(orchestrator, {
 *   verbose: flags.verbose,
 *   silent: flags.silent,
 *   skipTechnologyJsScan: flags.skipTechnologyJsScan,
 * });
 * ```
 */
export async function runPostCrawlTaskList(
	orchestrator: CrawlerOrchestrator,
	options: RunPostCrawlTaskListOptions,
): Promise<void> {
	if (options.silent) {
		if (!options.skipTechnologyJsScan) {
			await scanJsResourcesQuietly(orchestrator.archive);
		}
		await ensureViewerReadModelQuietly(orchestrator.archive);
		await orchestrator.write();
		return;
	}

	let pipeline = TaskList.from(orchestrator);
	if (!options.skipTechnologyJsScan) {
		pipeline = pipeline.pipe(
			'Scan JS resources',
			async (orch: CrawlerOrchestrator, ctx: StepContext<CrawlerOrchestrator>) => {
				await scanJsResourcesQuietly(orch.archive, (message) => {
					ctx.progress(message);
				});
				return orch;
			},
		);
	}
	const finalPipeline = pipeline
		.pipe(
			'Build viewer read model',
			async (orch: CrawlerOrchestrator, ctx: StepContext<CrawlerOrchestrator>) => {
				await ensureViewerReadModelQuietly(orch.archive, (message) => {
					ctx.progress(message);
				});
				return orch;
			},
		)
		.pipe(
			'Write archive',
			async (orch: CrawlerOrchestrator, ctx: StepContext<CrawlerOrchestrator>) => {
				orch.on('writeStep', ({ step }) => {
					ctx.progress(WRITE_STEP_LABELS[step]);
				});
				const reportTarProgress = createByteProgressLogger(
					(message) => {
						ctx.progress(message);
					},
					WRITE_STEP_LABELS.tar,
					{ animated: false },
				);
				orch.on('writeTarProgress', ({ writtenBytes, totalBytes }) => {
					reportTarProgress(writtenBytes, totalBytes);
				});
				await orch.write();
				return orch;
			},
		);

	const baseStream = options.stream ?? process.stderr;
	const stream = options.verbose ? createVerboseTimestampStream(baseStream) : baseStream;
	await finalPipeline.run({ stream, verbose: options.verbose });
}
