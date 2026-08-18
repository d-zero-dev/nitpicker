import { Lanes } from '@d-zero/dealer';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

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
	[Symbol.asyncDispose]: mockArchiveClose,
});
const mockCopyFileWithProgress = vi.fn().mockResolvedValue();

vi.mock('@nitpicker/crawler', () => ({
	Archive: { open: mockArchiveOpen },
	copyFileWithProgress: mockCopyFileWithProgress,
}));

const mockLanesUpdate = vi.fn();

vi.mock('@d-zero/dealer', () => ({
	Lanes: vi.fn().mockImplementation(function (this: {
		update: typeof mockLanesUpdate;
		[Symbol.dispose]: ReturnType<typeof vi.fn>;
	}) {
		this.update = mockLanesUpdate;
		this[Symbol.dispose] = vi.fn();
	}),
}));

const mockBuildViewerReadModelInWorker = vi.fn().mockResolvedValue();
const mockEnsureViewerReadModelInWorker = vi.fn().mockResolvedValue();
const mockRunViewerReadModelBackfillsInWorker = vi.fn().mockResolvedValue();

vi.mock('@nitpicker/query', () => ({
	buildViewerReadModelInWorker: mockBuildViewerReadModelInWorker,
	ensureViewerReadModelInWorker: mockEnsureViewerReadModelInWorker,
	runViewerReadModelBackfillsInWorker: mockRunViewerReadModelBackfillsInWorker,
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

	beforeEach(() => {
		vi.clearAllMocks();
		mockUnlink.mockResolvedValue();
		mockCopyFileWithProgress.mockResolvedValue();
		mockArchiveOpen.mockResolvedValue({
			write: mockArchiveWrite,
			close: mockArchiveClose,
			[Symbol.asyncDispose]: mockArchiveClose,
		});
		mockArchiveWrite.mockResolvedValue();
		mockArchiveClose.mockResolvedValue();
		mockBuildViewerReadModelInWorker.mockResolvedValue();
		// Default: the schema-version gate reports "already current" (no
		// build ran), the branch where the backfills worker task fires.
		mockEnsureViewerReadModelInWorker.mockResolvedValue(false);
		mockRunViewerReadModelBackfillsInWorker.mockResolvedValue();
		// Default: archive exists, no stale backup — the happy-path shape.
		mockExistsSync.mockImplementation((p: string) => !p.endsWith('.bak'));
		mockStatSync.mockReturnValue({ isFile: () => true });

		exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new ExitError(code as number);
		});
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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

	it('calls ensureViewerReadModelInWorker (not buildViewerReadModelInWorker) by default', async () => {
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		expect(mockEnsureViewerReadModelInWorker).toHaveBeenCalledOnce();
		expect(mockBuildViewerReadModelInWorker).not.toHaveBeenCalled();
		expect(mockArchiveWrite).toHaveBeenCalledOnce();
		expect(mockArchiveClose).toHaveBeenCalledOnce();
		expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('.bak'));
	});

	it('displays each progress callback via the shared Lanes line', async () => {
		mockEnsureViewerReadModelInWorker.mockImplementation((_archive, options) => {
			options.onProgress({ insertedRows: 250, totalRows: 500 });
			return Promise.resolve();
		});
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			expect.stringContaining('Building viewer read model: 250/500 pages'),
		);
	});

	it('displays phase changes via the shared Lanes line (issue #294)', async () => {
		mockEnsureViewerReadModelInWorker.mockImplementation((_archive, options) => {
			options.onPhase('buildingAnchorFacts');
			return Promise.resolve();
		});
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			expect.stringContaining('Building anchor facts'),
		);
	});

	it('logs an animated start line and a completed line, with no timestamp by default (issue #294)', async () => {
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Viewer read model build: starting%dots%',
		);
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'Viewer read model build: completed',
		);
	});

	it('reports each archive.write() step via a labeled, animated line (issue #294)', async () => {
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
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Checkpointing database%dots%',
		);
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Finalizing archive layout%dots%',
		);
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Writing archive%dots%',
		);
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Removing temporary files%dots%',
		);
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
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Writing archive: 50/200 MB (25%)',
		);
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Writing archive: 200/200 MB (100%)',
		);
	});

	it('passes --verbose through to Lanes and prefixes every line with an ISO 8601 timestamp (issue #294)', async () => {
		mockEnsureViewerReadModelInWorker.mockImplementation((_archive, options) => {
			options.onPhase('buildingAnchorFacts');
			options.onProgress({ insertedRows: 250, totalRows: 500 });
			return Promise.resolve();
		});
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], { verbose: true } as never);

		expect(Lanes).toHaveBeenCalledWith(expect.objectContaining({ verbose: true }));
		const isoTimestamp = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/;
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			expect.stringMatching(
				new RegExp(`^${isoTimestamp.source} .*build: starting%dots%$`),
			),
		);
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			expect.stringMatching(
				new RegExp(`^${isoTimestamp.source} .*Building anchor facts`),
			),
		);
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			expect.stringMatching(new RegExp(`^${isoTimestamp.source} .*250/500 id ranges`)),
		);
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
		});
	});

	it('displays extraction progress in MB while Archive.open untars, deduplicated on the rendered message (issue #294)', async () => {
		mockArchiveOpen.mockImplementation(
			(options: {
				onExtractProgress: (readBytes: number, totalBytes: number) => void;
			}) => {
				options.onExtractProgress(10_000_000, 100_000_000);
				// Renders identically to the first call (same rounded MB and
				// percent) — must not repaint.
				options.onExtractProgress(10_400_000, 100_000_000);
				options.onExtractProgress(100_000_000, 100_000_000);
				return Promise.resolve({
					write: mockArchiveWrite,
					close: mockArchiveClose,
					[Symbol.asyncDispose]: mockArchiveClose,
				});
			},
		);
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Extracting archive%dots%',
		);
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Extracting archive: 10/100 MB (10%)',
		);
		expect(mockLanesUpdate).not.toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Extracting archive: 10.4/100 MB (10%)',
		);
		const extractionUpdates = mockLanesUpdate.mock.calls.filter(([, message]) =>
			String(message).includes('Extracting archive:'),
		);
		expect(extractionUpdates).toHaveLength(2);
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Extracting archive: 100/100 MB (100%)',
		);
	});

	it('calls buildViewerReadModelInWorker (forced rebuild) when --force is passed', async () => {
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], { force: true } as never);

		expect(mockBuildViewerReadModelInWorker).toHaveBeenCalledOnce();
		expect(mockEnsureViewerReadModelInWorker).not.toHaveBeenCalled();
	});

	it('dispatches the backfills worker task when the schema-version gate skips the build', async () => {
		// The three unconditional backfills are not covered by the gate
		// (body_hash/alias_of_id never changed the read-model schema;
		// dedupe_cap_event_id's data changes on every re-crawl without one),
		// so an already-current archive still needs this catch-up pass.
		mockEnsureViewerReadModelInWorker.mockResolvedValue(false);
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

	it('skips the backfills worker task when the gate actually built (the build includes them)', async () => {
		mockEnsureViewerReadModelInWorker.mockResolvedValue(true);
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		expect(mockRunViewerReadModelBackfillsInWorker).not.toHaveBeenCalled();
	});

	it('skips the backfills worker task on --force too (a forced build includes them)', async () => {
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], { force: true } as never);

		expect(mockBuildViewerReadModelInWorker).toHaveBeenCalledOnce();
		expect(mockRunViewerReadModelBackfillsInWorker).not.toHaveBeenCalled();
	});

	it('displays the backfills-task phases and progress via the shared Lanes line', async () => {
		mockEnsureViewerReadModelInWorker.mockResolvedValue(false);
		mockRunViewerReadModelBackfillsInWorker.mockImplementation((_archive, options) => {
			options.onPhase('backfillingBodyHash');
			options.onProgress({ insertedRows: 3, totalRows: 10 });
			return Promise.resolve();
		});
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			expect.stringContaining('Backfilling page content hashes'),
		);
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Backfilling page content hashes: 3/10 pages (30%)',
		);
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
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Backing up archive%dots%',
		);
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Backing up archive: 50/200 MB (25%)',
		);
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Backing up archive: 200/200 MB (100%)',
		);
	});

	it('restores the backup, removes it, and exits fatally when the build fails', async () => {
		mockEnsureViewerReadModelInWorker.mockRejectedValue(new Error('build broke'));
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

	it('displays restore progress in MB via copyFileWithProgress on failure (issue #294)', async () => {
		mockEnsureViewerReadModelInWorker.mockRejectedValue(new Error('build broke'));
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

		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Restoring archive from backup%dots%',
		);
		expect(mockLanesUpdate).toHaveBeenCalledWith(
			expect.any(Number),
			'%braille% Restoring archive from backup: 100/100 MB (100%)',
		);
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
		mockEnsureViewerReadModelInWorker.mockRejectedValue(new Error('build broke'));
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
	});
});
