import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { VIEWER_READ_MODEL_BACKFILL_PHASES } from '../viewer-read-model-backfill-phases.js';
import { VIEWER_READ_MODEL_FULL_BUILD_PHASES } from '../viewer-read-model-full-build-phases.js';

/**
 * Calls `onPhase` for each phase in order, yielding a microtask tick after
 * each call — the same gap the real `buildViewerReadModel`/backfills worker
 * always has before the next `onPhase` (each is followed by a genuinely
 * awaited operation), needed here so dealer's `TaskListPipeline` has a
 * chance to advance to the next row before the next call arrives (mirrors
 * `create-setup-task-list.spec.ts`'s `tick()` helper).
 * @param options
 * @param options.onPhase
 * @param phases
 */
async function driveOnPhase(
	options: { onPhase: (phase: string) => void },
	phases: readonly string[],
): Promise<void> {
	for (const phase of phases) {
		options.onPhase(phase);
		await Promise.resolve();
	}
}

const mockExistsSync = vi.fn();
const mockStatSync = vi.fn();
const mockUnlink = vi.fn().mockResolvedValue();

vi.mock('node:fs', () => ({
	existsSync: mockExistsSync,
	statSync: mockStatSync,
}));

vi.mock('node:fs/promises', () => ({
	unlink: mockUnlink,
}));

const mockArchiveClose = vi.fn().mockResolvedValue();
const mockArchiveWrite = vi.fn().mockResolvedValue();
const mockArchiveOpen = vi.fn().mockResolvedValue({
	write: mockArchiveWrite,
	close: mockArchiveClose,
});
const mockCopyFileWithProgress = vi.fn().mockResolvedValue();

vi.mock('@nitpicker/crawler', () => ({
	Archive: { open: mockArchiveOpen },
	copyFileWithProgress: mockCopyFileWithProgress,
}));

const mockBuildViewerReadModelInWorker = vi.fn().mockResolvedValue();
const mockGetViewerReadModelVersion = vi.fn();
const mockRunViewerReadModelBackfillsInWorker = vi.fn().mockResolvedValue();

vi.mock('@nitpicker/query', () => ({
	buildViewerReadModelInWorker: mockBuildViewerReadModelInWorker,
	getViewerReadModelVersion: mockGetViewerReadModelVersion,
	runViewerReadModelBackfillsInWorker: mockRunViewerReadModelBackfillsInWorker,
	VIEWER_READ_MODEL_SCHEMA_VERSION: 29,
}));

const mockFormatCliError = vi.fn();

vi.mock('../format-cli-error.js', () => ({
	formatCliError: mockFormatCliError,
}));

/** Sentinel error thrown by the process.exit mock to halt execution. */
class ExitError extends Error {
	/** The exit code passed to process.exit(). */
	readonly code: number;
	constructor(code: number) {
		super(`process.exit(${code})`);
		this.code = code;
	}
}

describe('viewerBuild command', () => {
	let exitSpy: ReturnType<typeof vi.spyOn>;
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
	let stderrSpy: ReturnType<typeof vi.spyOn>;

	/** Concatenates every chunk written to stderr during the test, for substring assertions. */
	function renderedOutput(): string {
		return stderrSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
	}

	beforeEach(() => {
		vi.clearAllMocks();
		mockUnlink.mockResolvedValue();
		mockCopyFileWithProgress.mockResolvedValue();
		mockArchiveOpen.mockResolvedValue({
			write: mockArchiveWrite,
			close: mockArchiveClose,
		});
		mockArchiveWrite.mockResolvedValue();
		mockArchiveClose.mockResolvedValue();
		// Drives the real, full phase sequences by default so every row a
		// call doesn't override still settles instead of hanging forever —
		// `appendViewerReadModelPhaseRows` only resolves a row on the next
		// `onPhase` call (or the final one via `runBuild`'s own resolution),
		// exactly matching what the real worker tasks always do.
		mockBuildViewerReadModelInWorker.mockImplementation(async (_archive, options) => {
			await driveOnPhase(options, VIEWER_READ_MODEL_FULL_BUILD_PHASES);
		});
		// Default: the schema-version gate reports "already current" (matches
		// the mocked VIEWER_READ_MODEL_SCHEMA_VERSION), the branch where the
		// backfills worker task fires instead of a full rebuild.
		mockGetViewerReadModelVersion.mockResolvedValue(29);
		mockRunViewerReadModelBackfillsInWorker.mockImplementation(
			async (_archive, options) => {
				await driveOnPhase(options, VIEWER_READ_MODEL_BACKFILL_PHASES);
			},
		);
		// Default: archive exists, no stale backup — the happy-path shape.
		mockExistsSync.mockImplementation((p: string) => !p.endsWith('.bak'));
		mockStatSync.mockReturnValue({ isFile: () => true });

		exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new ExitError(code as number);
		});
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		// The command renders its TaskList(s) to the real `process.stderr`
		// (no injectable stream — verbose/non-verbose both go through it).
		// Real `@d-zero/dealer` runs unmocked so the actual state-machine
		// (pending → running → done/error, insertNext) is exercised.
		stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('exits with error when no archive path is provided', async () => {
		const { viewerBuild } = await import('./viewer-build.js');
		await expect(viewerBuild([], {} as never)).rejects.toThrow(ExitError);

		expect(consoleErrorSpy).toHaveBeenCalledWith('Error: No .nitpicker file specified.');
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('exits with error when the archive does not exist', async () => {
		mockExistsSync.mockReturnValue(false);
		const { viewerBuild } = await import('./viewer-build.js');

		await expect(viewerBuild(['/tmp/missing.nitpicker'], {} as never)).rejects.toThrow(
			ExitError,
		);
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining('Archive not found'),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('exits with error when the path is a directory (e.g. a stub crawl dir)', async () => {
		mockStatSync.mockReturnValue({ isFile: () => false });
		const { viewerBuild } = await import('./viewer-build.js');

		await expect(viewerBuild(['/tmp/some-stub-dir'], {} as never)).rejects.toThrow(
			ExitError,
		);
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining('Not a .nitpicker file'),
		);
		expect(mockCopyFileWithProgress).not.toHaveBeenCalled();
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('exits with error when a stale .bak backup is already present', async () => {
		mockExistsSync.mockImplementation(() => true);
		const { viewerBuild } = await import('./viewer-build.js');

		await expect(viewerBuild(['/tmp/existing.nitpicker'], {} as never)).rejects.toThrow(
			ExitError,
		);
		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Stale backup'));
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('checks the schema-version gate (not buildViewerReadModelInWorker) by default', async () => {
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		expect(mockGetViewerReadModelVersion).toHaveBeenCalledOnce();
		expect(mockBuildViewerReadModelInWorker).not.toHaveBeenCalled();
		expect(mockArchiveWrite).toHaveBeenCalledOnce();
		expect(mockArchiveClose).toHaveBeenCalledOnce();
		expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('.bak'));
	});

	it('renders the task-list rows for each step in order, with every read-model phase fully expanded (issue #294)', async () => {
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		const output = renderedOutput();
		expect(output).toContain('Back up archive');
		expect(output).toContain('Extract archive');
		// Default gate: schema already current — the 4 backfill-only phases
		// render as individual rows, never collapsed into a single row.
		expect(output).not.toContain('Build viewer read model');
		expect(output).not.toContain('Run backfills');
		expect(output).toContain('Backfilling page content hashes');
		expect(output).toContain('Backfilling duplicate page links');
		expect(output).toContain('Backfilling dedupe-cap markers');
		expect(output).toContain('Checkpointing read model');
		expect(output).toContain('Write archive');
	});

	it('renders all 21 full-build phases as individual rows when --force is passed (issue #294)', async () => {
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], { force: true } as never);

		const output = renderedOutput();
		for (const label of [
			'Backfilling analysis violations',
			'Computing summary',
			'Building pages',
			'Building anchor facts',
			'Creating indexes',
			'Committing read model',
			'Checkpointing read model',
		]) {
			expect(output).toContain(label);
		}
	});

	it('reports each progress callback via the row message, without repeating the row label', async () => {
		mockRunViewerReadModelBackfillsInWorker.mockImplementation(
			async (_archive, options) => {
				options.onPhase('backfillingBodyHash');
				await Promise.resolve();
				options.onProgress({ insertedRows: 250, totalRows: 500 });
				await driveOnPhase(options, [
					'backfillingAliasOfId',
					'backfillingDedupeCapEventId',
					'checkpointing',
				]);
			},
		);
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		const output = renderedOutput();
		// dealer prefixes every row's message with its own name — that single
		// prefix is expected. The bug this guards against is the row's
		// *message* also embedding the label a second time, which would
		// render as a doubled label.
		expect(output).toContain('Backfilling page content hashes: 250/500 pages (50%)');
		expect(output).not.toContain(
			'Backfilling page content hashes: Backfilling page content hashes:',
		);
	});

	it('reports phase changes via the row message (issue #294)', async () => {
		// Default mockBuildViewerReadModelInWorker already drives the full
		// 21-phase sequence (including 'buildingAnchorFacts') to completion.
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], { force: true } as never);

		expect(renderedOutput()).toContain('Building anchor facts');
	});

	it('reports each archive.write() step via a labeled row message (issue #294)', async () => {
		mockArchiveWrite.mockImplementation(
			(options: {
				onStep: (step: 'checkpoint' | 'rename' | 'tar' | 'remove') => void;
			}) => {
				options.onStep('checkpoint');
				options.onStep('rename');
				options.onStep('tar');
				options.onStep('remove');
				return Promise.resolve();
			},
		);
		const { viewerBuild } = await import('./viewer-build.js');
		// --verbose: non-verbose `Lanes` batches renders on a ~33ms timer that
		// never fires within a synchronous test, so intermediate updates are
		// invisible unless every state transition writes immediately.
		await viewerBuild(['/tmp/existing.nitpicker'], { verbose: true } as never);

		const output = renderedOutput();
		expect(output).toContain('Checkpointing database');
		expect(output).toContain('Finalizing archive layout');
		expect(output).toContain('Removing temporary files');
	});

	it('displays tar write-back progress in MB via archive.write (issue #294)', async () => {
		mockArchiveWrite.mockImplementation(
			(options: {
				onTarProgress: (writtenBytes: number, totalBytes: number) => void;
			}) => {
				options.onTarProgress(50_000_000, 200_000_000);
				options.onTarProgress(200_000_000, 200_000_000);
				return Promise.resolve();
			},
		);
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], { verbose: true } as never);

		const output = renderedOutput();
		expect(output).toContain('50/200 MB (25%)');
		expect(output).toContain('200/200 MB (100%)');
	});

	it('deduplicates identical byte-progress messages instead of re-rendering on every chunk (issue #294 code review)', async () => {
		mockArchiveWrite.mockImplementation(
			(options: {
				onTarProgress: (writtenBytes: number, totalBytes: number) => void;
			}) => {
				// Two chunks that round to the same "50/200 MB (25%)" text — a
				// multi-GB archive fires this every ~64 KB, so without
				// deduplication this single value would re-render thousands of
				// times per step.
				options.onTarProgress(50_000_000, 200_000_000);
				options.onTarProgress(50_100_000, 200_000_000);
				options.onTarProgress(200_000_000, 200_000_000);
				return Promise.resolve();
			},
		);
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], { verbose: true } as never);

		const lines = stderrSpy.mock.calls.map(([chunk]) => String(chunk));
		const matchingLines = lines.filter((line) => line.includes('50/200 MB (25%)'));
		expect(matchingLines).toHaveLength(1);
	});

	it('passes --verbose through and prefixes every line with an ISO 8601 timestamp (issue #294)', async () => {
		mockBuildViewerReadModelInWorker.mockImplementation(async (_archive, options) => {
			const anchorIndex =
				VIEWER_READ_MODEL_FULL_BUILD_PHASES.indexOf('buildingAnchorFacts');
			await driveOnPhase(
				options,
				VIEWER_READ_MODEL_FULL_BUILD_PHASES.slice(0, anchorIndex + 1),
			);
			options.onProgress({ insertedRows: 250, totalRows: 500 });
			await driveOnPhase(
				options,
				VIEWER_READ_MODEL_FULL_BUILD_PHASES.slice(anchorIndex + 1),
			);
		});
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], {
			verbose: true,
			force: true,
		} as never);

		const isoTimestamp = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/;
		const lines = stderrSpy.mock.calls.map(([chunk]) => String(chunk));
		expect(lines.some((line) => isoTimestamp.test(line))).toBe(true);
		expect(
			lines.some(
				(line) => isoTimestamp.test(line) && line.includes('Building anchor facts'),
			),
		).toBe(true);
	});

	it('opens the archive without overriding cwd (matches every other Archive.open call site)', async () => {
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		// `openPluginData: true` — otherwise `write()` below would silently
		// drop any non-`db.sqlite` tar entry (analyze output, a saved
		// inventory list) from the archive (issue #99 regression guard).
		expect(mockArchiveOpen).toHaveBeenCalledWith({
			filePath: '/tmp/existing.nitpicker',
			openPluginData: true,
			onExtractProgress: expect.any(Function),
			onLog: expect.any(Function),
		});
	});

	it('displays extraction progress in MB while Archive.open untars (issue #294)', async () => {
		mockArchiveOpen.mockImplementation(
			(options: {
				onExtractProgress: (readBytes: number, totalBytes: number) => void;
			}) => {
				options.onExtractProgress(10_000_000, 100_000_000);
				options.onExtractProgress(100_000_000, 100_000_000);
				return Promise.resolve({
					write: mockArchiveWrite,
					close: mockArchiveClose,
				});
			},
		);
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], { verbose: true } as never);

		const output = renderedOutput();
		expect(output).toContain('Extract archive');
		expect(output).toContain('10/100 MB (10%)');
		expect(output).toContain('100/100 MB (100%)');
	});

	it('routes a legacy-archive migration notice through the Extract archive row instead of a bare console.error (issue #294)', async () => {
		mockArchiveOpen.mockImplementation(
			(options: { onLog?: (message: string) => void }) => {
				options.onLog?.('[migrate] page_meta.body_hash column added');
				return Promise.resolve({
					write: mockArchiveWrite,
					close: mockArchiveClose,
				});
			},
		);
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], { verbose: true } as never);

		const output = renderedOutput();
		expect(output).toContain('Extract archive');
		expect(output).toContain('[migrate] page_meta.body_hash column added');
	});

	it('calls buildViewerReadModelInWorker (forced rebuild) when --force is passed, without checking the gate', async () => {
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], { force: true } as never);

		expect(mockBuildViewerReadModelInWorker).toHaveBeenCalledOnce();
		expect(mockGetViewerReadModelVersion).not.toHaveBeenCalled();
	});

	it('dispatches the backfills worker task when the schema-version gate reports the read model is already current', async () => {
		// The three unconditional backfills are not covered by the gate
		// (body_hash/alias_of_id never changed the read-model schema;
		// dedupe_cap_event_id's data changes on every re-crawl without one),
		// so an already-current archive still needs this catch-up pass.
		mockGetViewerReadModelVersion.mockResolvedValue(29);
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		expect(mockRunViewerReadModelBackfillsInWorker).toHaveBeenCalledOnce();
		expect(mockRunViewerReadModelBackfillsInWorker).toHaveBeenCalledWith(
			expect.objectContaining({ write: mockArchiveWrite }),
			expect.objectContaining({
				onPhase: expect.any(Function),
				onProgress: expect.any(Function),
			}),
		);
		const backfillsOrder =
			mockRunViewerReadModelBackfillsInWorker.mock.invocationCallOrder[0];
		const writeOrder = mockArchiveWrite.mock.invocationCallOrder[0];
		expect(backfillsOrder!).toBeLessThan(writeOrder!);
	});

	it('skips the backfills worker task when the gate reports a stale schema (a full build includes them)', async () => {
		mockGetViewerReadModelVersion.mockResolvedValue(1);
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		expect(mockBuildViewerReadModelInWorker).toHaveBeenCalledOnce();
		expect(mockRunViewerReadModelBackfillsInWorker).not.toHaveBeenCalled();
	});

	it('skips the backfills worker task on --force too (a forced build includes them)', async () => {
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], { force: true } as never);

		expect(mockBuildViewerReadModelInWorker).toHaveBeenCalledOnce();
		expect(mockRunViewerReadModelBackfillsInWorker).not.toHaveBeenCalled();
	});

	it('renders each backfill phase as its own row, never collapsed under a parent row (issue #294)', async () => {
		mockRunViewerReadModelBackfillsInWorker.mockImplementation(
			async (_archive, options) => {
				options.onPhase('backfillingBodyHash');
				await Promise.resolve();
				options.onProgress({ insertedRows: 3, totalRows: 10 });
				await driveOnPhase(options, [
					'backfillingAliasOfId',
					'backfillingDedupeCapEventId',
					'checkpointing',
				]);
			},
		);
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		const output = renderedOutput();
		expect(output).not.toContain('Run backfills');
		expect(output).toContain('Backfilling page content hashes');
		expect(output).toContain('3/10 pages (30%)');
	});

	it('takes a backup, with byte progress, before opening the archive writably (issue #294)', async () => {
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		expect(mockCopyFileWithProgress).toHaveBeenCalledWith(
			'/tmp/existing.nitpicker',
			'/tmp/existing.nitpicker.bak',
			expect.any(Function),
		);
		const copyOrder = mockCopyFileWithProgress.mock.invocationCallOrder[0];
		const openOrder = mockArchiveOpen.mock.invocationCallOrder[0];
		expect(copyOrder!).toBeLessThan(openOrder!);
	});

	it('displays backup progress in MB via copyFileWithProgress (issue #294)', async () => {
		mockCopyFileWithProgress.mockImplementation(
			(
				_src: string,
				_dest: string,
				onProgress?: (copiedBytes: number, totalBytes: number) => void,
			) => {
				onProgress?.(50_000_000, 200_000_000);
				onProgress?.(200_000_000, 200_000_000);
				return Promise.resolve();
			},
		);
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], { verbose: true } as never);

		const output = renderedOutput();
		expect(output).toContain('Back up archive');
		expect(output).toContain('50/200 MB (25%)');
		expect(output).toContain('200/200 MB (100%)');
	});

	it('restores the backup, removes it, and exits fatally when the build fails', async () => {
		mockRunViewerReadModelBackfillsInWorker.mockRejectedValue(new Error('build broke'));
		const { viewerBuild } = await import('./viewer-build.js');

		await expect(viewerBuild(['/tmp/existing.nitpicker'], {} as never)).rejects.toThrow(
			ExitError,
		);

		// First copyFileWithProgress call is the backup (archive -> .bak);
		// second is the restore (.bak -> archive) after the failure.
		expect(mockCopyFileWithProgress).toHaveBeenCalledTimes(2);
		expect(mockCopyFileWithProgress.mock.calls[1]![0]).toBe(
			'/tmp/existing.nitpicker.bak',
		);
		expect(mockCopyFileWithProgress.mock.calls[1]![1]).toBe('/tmp/existing.nitpicker');
		expect(mockUnlink).toHaveBeenCalledWith('/tmp/existing.nitpicker.bak');
		expect(mockFormatCliError).toHaveBeenCalledWith(expect.any(Error), false);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('does not attempt a restore when the backup copy itself fails (issue #294: restoring a truncated backup would destroy the intact original)', async () => {
		mockCopyFileWithProgress.mockRejectedValueOnce(new Error('disk full during backup'));
		const { viewerBuild } = await import('./viewer-build.js');

		await expect(viewerBuild(['/tmp/existing.nitpicker'], {} as never)).rejects.toThrow(
			ExitError,
		);

		// Only the failed backup attempt — no restore copy back onto the
		// still-intact original archive.
		expect(mockCopyFileWithProgress).toHaveBeenCalledTimes(1);
		expect(mockArchiveOpen).not.toHaveBeenCalled();
		expect(mockFormatCliError).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'disk full during backup' }),
			false,
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('displays restore progress in MB via copyFileWithProgress on failure (issue #294)', async () => {
		mockRunViewerReadModelBackfillsInWorker.mockRejectedValue(new Error('build broke'));
		mockCopyFileWithProgress
			.mockImplementationOnce(() => {
				// backup succeeds silently
				return Promise.resolve();
			})
			.mockImplementationOnce(
				(
					_src: string,
					_dest: string,
					onProgress?: (copiedBytes: number, totalBytes: number) => void,
				) => {
					onProgress?.(100_000_000, 100_000_000);
					return Promise.resolve();
				},
			);
		const { viewerBuild } = await import('./viewer-build.js');

		await expect(viewerBuild(['/tmp/existing.nitpicker'], {} as never)).rejects.toThrow(
			ExitError,
		);

		const output = renderedOutput();
		expect(output).toContain('Restore from backup');
		expect(output).toContain('100/100 MB (100%)');
	});

	it('restores the backup and exits fatally when archive.write() fails', async () => {
		mockArchiveWrite.mockRejectedValue(new Error('disk full'));
		const { viewerBuild } = await import('./viewer-build.js');

		await expect(viewerBuild(['/tmp/existing.nitpicker'], {} as never)).rejects.toThrow(
			ExitError,
		);
		expect(mockCopyFileWithProgress).toHaveBeenCalledTimes(2);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('does not throw when the backup was already removed out-of-band (ENOENT on success-path unlink)', async () => {
		const enoent = Object.assign(new Error('no such file'), { code: 'ENOENT' });
		mockUnlink.mockRejectedValueOnce(enoent);
		const { viewerBuild } = await import('./viewer-build.js');

		await expect(
			viewerBuild(['/tmp/existing.nitpicker'], {} as never),
		).resolves.toBeUndefined();
		expect(exitSpy).not.toHaveBeenCalled();
	});

	it('surfaces both errors via AggregateError when the build fails AND the restore also fails', async () => {
		mockRunViewerReadModelBackfillsInWorker.mockRejectedValue(new Error('build broke'));
		mockCopyFileWithProgress.mockImplementationOnce(() => Promise.resolve()); // backup succeeds
		mockCopyFileWithProgress.mockImplementationOnce(() =>
			Promise.reject(new Error('restore disk full')),
		);
		const { viewerBuild } = await import('./viewer-build.js');

		await expect(viewerBuild(['/tmp/existing.nitpicker'], {} as never)).rejects.toThrow(
			ExitError,
		);

		expect(mockFormatCliError).toHaveBeenCalledWith(expect.any(AggregateError), false);
		const [aggregateError] = mockFormatCliError.mock.calls[0]!;
		expect(aggregateError.errors).toHaveLength(2);
		expect(aggregateError.errors[0].message).toBe('build broke');
		expect(aggregateError.errors[1].message).toBe('restore disk full');
		expect(aggregateError.message).toContain('restore from backup failed');
		expect(exitSpy).toHaveBeenCalledWith(1);
		// issue #294 code review: process.exit() runs immediately and skips a
		// sibling finally block, so close() must happen BEFORE it, not inside
		// one — this is the one branch that regression previously slipped
		// through untested.
		expect(mockArchiveClose).toHaveBeenCalledOnce();
	});

	it('closes the archive once the pipeline completes successfully', async () => {
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		expect(mockArchiveClose).toHaveBeenCalledOnce();
	});

	it('closes the archive even when a later step fails', async () => {
		mockArchiveWrite.mockRejectedValue(new Error('disk full'));
		const { viewerBuild } = await import('./viewer-build.js');

		await expect(viewerBuild(['/tmp/existing.nitpicker'], {} as never)).rejects.toThrow(
			ExitError,
		);

		expect(mockArchiveClose).toHaveBeenCalledOnce();
	});
});
