import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { BuildViewerReadModelOptions } from '@nitpicker/query';

import { TaskList } from '@d-zero/dealer';
import { describe, it, expect, vi } from 'vitest';

import { appendViewerReadModelPhaseRows } from './append-viewer-read-model-phase-rows.js';
import { VIEWER_READ_MODEL_BACKFILL_PHASES } from './viewer-read-model-backfill-phases.js';
import { VIEWER_READ_MODEL_FULL_BUILD_PHASES } from './viewer-read-model-full-build-phases.js';

/** A placeholder value standing in for the archive flowing through the pipeline under test. */
const fakeArchive = {} as ArchiveAccessor;

/**
 * Passes the pipeline's current value straight through — every test here only cares about row mechanics, not the archive itself.
 * @param value
 */
const getArchive = (value: ArchiveAccessor) => value;

/** A minimal writable that records every chunk written to it, verbatim. */
function createCapturingStream() {
	const lines: string[] = [];
	const stream: NodeJS.WritableStream = {
		write: (chunk: string) => {
			lines.push(chunk);
			return true;
		},
		on: () => stream,
		off: () => stream,
	} as unknown as NodeJS.WritableStream;
	return { stream, lines };
}

/**
 * Calls `onPhase` for each phase in order, yielding a microtask tick after
 * each call — the gap the real `buildViewerReadModel`/backfills worker
 * always has before the next `onPhase` (each is followed by a genuinely
 * awaited operation), needed so dealer's `TaskListPipeline` has a chance to
 * advance to the next row before the next call arrives (mirrors
 * `crawl/create-setup-task-list.spec.ts`'s `tick()` helper).
 * @param options
 * @param phases
 */
async function driveOnPhase(
	options: BuildViewerReadModelOptions,
	phases: readonly string[],
): Promise<void> {
	for (const phase of phases) {
		options.onPhase?.(phase as never);
		await Promise.resolve();
	}
}

describe('appendViewerReadModelPhaseRows', () => {
	it('renders every phase in the full 21-phase build array as its own row, in order', async () => {
		const runBuild = vi.fn(
			async (_accessor: ArchiveAccessor, options: BuildViewerReadModelOptions) => {
				await driveOnPhase(options, VIEWER_READ_MODEL_FULL_BUILD_PHASES);
			},
		);
		const { stream, lines } = createCapturingStream();

		await appendViewerReadModelPhaseRows(
			TaskList.from(fakeArchive),
			VIEWER_READ_MODEL_FULL_BUILD_PHASES,
			{ getArchive, runBuild },
		).run({ stream, verbose: true });

		const rendered = lines.join('');
		expect(rendered).toContain('Backfilling analysis violations');
		expect(rendered).toContain('Building anchor facts');
		expect(rendered).toContain('Creating indexes');
		expect(rendered).toContain('Committing read model');
		expect(rendered).toContain('Checkpointing read model');
	});

	it('renders exactly the 4-phase backfill array, not the full build array', async () => {
		const runBuild = vi.fn(
			async (_accessor: ArchiveAccessor, options: BuildViewerReadModelOptions) => {
				await driveOnPhase(options, VIEWER_READ_MODEL_BACKFILL_PHASES);
			},
		);
		const { stream, lines } = createCapturingStream();

		await appendViewerReadModelPhaseRows(
			TaskList.from(fakeArchive),
			VIEWER_READ_MODEL_BACKFILL_PHASES,
			{ getArchive, runBuild },
		).run({ stream, verbose: true });

		const rendered = lines.join('');
		expect(rendered).toContain('Backfilling page content hashes');
		expect(rendered).toContain('Backfilling duplicate page links');
		expect(rendered).toContain('Backfilling dedupe-cap markers');
		expect(rendered).toContain('Checkpointing read model');
		expect(rendered).not.toContain('Backfilling analysis violations');
		expect(rendered).not.toContain('Building anchor facts');
	});

	it('reports onProgress on the active row without repeating its own label', async () => {
		const runBuild = vi.fn(
			async (_accessor: ArchiveAccessor, options: BuildViewerReadModelOptions) => {
				options.onPhase?.('creatingIndexes');
				await Promise.resolve();
				options.onProgress?.({ insertedRows: 23, totalRows: 57 });
			},
		);
		const { stream, lines } = createCapturingStream();

		await appendViewerReadModelPhaseRows(
			TaskList.from(fakeArchive),
			['creatingIndexes'],
			{
				getArchive,
				runBuild,
			},
		).run({ stream, verbose: true });

		const rendered = lines.join('');
		// dealer prefixes every row's message with its own name
		// ("Creating indexes: 23/57 indexes (40%)") — that single prefix is
		// expected. The bug this guards against is the row's *message* also
		// embedding the label a second time, which would render as a doubled
		// label ("Creating indexes: Creating indexes: ...").
		expect(rendered).toContain('Creating indexes: 23/57 indexes (40%)');
		expect(rendered).not.toContain('Creating indexes: Creating indexes:');
	});

	it('defaults the progress unit to "pages" for phases absent from PROGRESS_UNIT_BY_PHASE', async () => {
		const runBuild = vi.fn(
			(
				_accessor: ArchiveAccessor,
				options: BuildViewerReadModelOptions,
			): Promise<void> => {
				options.onProgress?.({ insertedRows: 250, totalRows: 500 });
				return Promise.resolve();
			},
		);
		const { stream, lines } = createCapturingStream();

		await appendViewerReadModelPhaseRows(TaskList.from(fakeArchive), ['buildingPages'], {
			getArchive,
			runBuild,
		}).run({ stream, verbose: true });

		expect(lines.join('')).toContain('250/500 pages (50%)');
	});

	it('fails loud by default: rejects the active row and leaves later rows pending', async () => {
		const boom = new Error('disk full');
		const runBuild = vi.fn(
			async (_accessor: ArchiveAccessor, options: BuildViewerReadModelOptions) => {
				options.onPhase?.('backfillingBodyHash');
				await Promise.resolve();
				throw boom;
			},
		);
		const { stream } = createCapturingStream();

		await expect(
			appendViewerReadModelPhaseRows(
				TaskList.from(fakeArchive),
				VIEWER_READ_MODEL_BACKFILL_PHASES,
				{ getArchive, runBuild },
			).run({ stream, verbose: true }),
		).rejects.toMatchObject({ cause: boom });
	});

	it('with onFailure set, resolves the failing row with the formatted message and skips the rest instead of rejecting', async () => {
		const boom = new Error('disk full');
		const runBuild = vi.fn(
			async (_accessor: ArchiveAccessor, options: BuildViewerReadModelOptions) => {
				options.onPhase?.('backfillingBodyHash');
				await Promise.resolve();
				throw boom;
			},
		);
		const { stream, lines } = createCapturingStream();

		const result = await appendViewerReadModelPhaseRows(
			TaskList.from(fakeArchive),
			VIEWER_READ_MODEL_BACKFILL_PHASES,
			{
				getArchive,
				runBuild,
				onFailure: (error) => `read model failed: ${(error as Error).message}`,
			},
		)
			.pipe('after', (value) => value)
			.run({ stream, verbose: true });

		expect(result).toBe(fakeArchive);
		const rendered = lines.join('');
		expect(rendered).toContain('read model failed: disk full');
		expect(rendered).toContain('skipped');
	});
});
