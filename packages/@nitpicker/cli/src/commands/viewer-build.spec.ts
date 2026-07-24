import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

const mockExistsSync = vi.fn();
const mockStatSync = vi.fn();
const mockCopyFile = vi.fn().mockResolvedValue();
const mockUnlink = vi.fn().mockResolvedValue();

vi.mock('node:fs', () => ({
	existsSync: mockExistsSync,
	statSync: mockStatSync,
}));

vi.mock('node:fs/promises', () => ({
	copyFile: mockCopyFile,
	unlink: mockUnlink,
}));

const mockArchiveClose = vi.fn().mockResolvedValue();
const mockArchiveWrite = vi.fn().mockResolvedValue();
const mockArchiveOpen = vi.fn().mockResolvedValue({
	write: mockArchiveWrite,
	close: mockArchiveClose,
});

vi.mock('@nitpicker/crawler', () => ({
	Archive: { open: mockArchiveOpen },
}));

const mockBuildViewerReadModel = vi.fn().mockResolvedValue();
const mockEnsureViewerReadModel = vi.fn().mockResolvedValue();
const mockBackfillBodyHashFromHtmlBlobs = vi.fn().mockResolvedValue();

vi.mock('@nitpicker/query', () => ({
	buildViewerReadModel: mockBuildViewerReadModel,
	ensureViewerReadModel: mockEnsureViewerReadModel,
	backfillBodyHashFromHtmlBlobs: mockBackfillBodyHashFromHtmlBlobs,
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
		mockCopyFile.mockResolvedValue();
		mockUnlink.mockResolvedValue();
		mockArchiveOpen.mockResolvedValue({
			write: mockArchiveWrite,
			close: mockArchiveClose,
		});
		mockArchiveWrite.mockResolvedValue();
		mockArchiveClose.mockResolvedValue();
		mockBuildViewerReadModel.mockResolvedValue();
		mockEnsureViewerReadModel.mockResolvedValue();
		mockBackfillBodyHashFromHtmlBlobs.mockResolvedValue();
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
		expect(mockCopyFile).not.toHaveBeenCalled();
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

	it('calls ensureViewerReadModel (not buildViewerReadModel) by default', async () => {
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		expect(mockEnsureViewerReadModel).toHaveBeenCalledOnce();
		expect(mockBuildViewerReadModel).not.toHaveBeenCalled();
		expect(mockArchiveWrite).toHaveBeenCalledOnce();
		expect(mockArchiveClose).toHaveBeenCalledOnce();
		expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('.bak'));
	});

	it('logs each progress callback to stderr via the shared formatter', async () => {
		mockEnsureViewerReadModel.mockImplementation((_archive, options) => {
			options.onProgress({ insertedRows: 250, totalRows: 500 });
			return Promise.resolve();
		});
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			'[nitpicker] building viewer read model: 250/500 pages',
		);
	});

	it('opens the archive without overriding cwd (matches every other Archive.open call site)', async () => {
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		expect(mockArchiveOpen).toHaveBeenCalledWith({ filePath: '/tmp/existing.nitpicker' });
	});

	it('calls buildViewerReadModel (forced rebuild) when --force is passed', async () => {
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], { force: true } as never);

		expect(mockBuildViewerReadModel).toHaveBeenCalledOnce();
		expect(mockEnsureViewerReadModel).not.toHaveBeenCalled();
	});

	it('always calls backfillBodyHashFromHtmlBlobs on the default (ensureViewerReadModel) path', async () => {
		// Regression guard: `ensureViewerReadModel`'s schema-version gate can
		// skip `buildViewerReadModel` entirely (and with it, the body_hash
		// backfill nested inside) on an archive whose read model is already
		// current — `body_hash` did not change that schema. The explicit
		// call here must run regardless.
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		expect(mockBackfillBodyHashFromHtmlBlobs).toHaveBeenCalledOnce();
		expect(mockBackfillBodyHashFromHtmlBlobs.mock.calls[0]![0]).toEqual({
			write: mockArchiveWrite,
			close: mockArchiveClose,
		});
	});

	it('always calls backfillBodyHashFromHtmlBlobs when --force is passed too', async () => {
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], { force: true } as never);

		expect(mockBackfillBodyHashFromHtmlBlobs).toHaveBeenCalledOnce();
	});

	it('logs backfillBodyHashFromHtmlBlobs progress to stderr', async () => {
		mockBackfillBodyHashFromHtmlBlobs.mockImplementation((_archive, onProgress) => {
			onProgress(3, 10);
			return Promise.resolve();
		});
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			'[nitpicker] page_meta.body_hash backfill: 3/10',
		);
	});

	it('runs backfillBodyHashFromHtmlBlobs before archive.write()', async () => {
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		const backfillOrder = mockBackfillBodyHashFromHtmlBlobs.mock.invocationCallOrder[0];
		const writeOrder = mockArchiveWrite.mock.invocationCallOrder[0];
		expect(backfillOrder!).toBeLessThan(writeOrder!);
	});

	it('takes a backup before opening the archive writably', async () => {
		const { viewerBuild } = await import('./viewer-build.js');
		await viewerBuild(['/tmp/existing.nitpicker'], {} as never);

		const copyOrder = mockCopyFile.mock.invocationCallOrder[0];
		const openOrder = mockArchiveOpen.mock.invocationCallOrder[0];
		expect(copyOrder!).toBeLessThan(openOrder!);
	});

	it('restores the backup, removes it, and exits fatally when the build fails', async () => {
		mockEnsureViewerReadModel.mockRejectedValue(new Error('build broke'));
		const { viewerBuild } = await import('./viewer-build.js');

		await expect(viewerBuild(['/tmp/existing.nitpicker'], {} as never)).rejects.toThrow(
			ExitError,
		);

		// First copyFile call is the backup (archive -> .bak); second is the
		// restore (.bak -> archive) after the failure.
		expect(mockCopyFile).toHaveBeenCalledTimes(2);
		expect(mockCopyFile.mock.calls[1]).toEqual([
			'/tmp/existing.nitpicker.bak',
			'/tmp/existing.nitpicker',
		]);
		expect(mockUnlink).toHaveBeenCalledWith('/tmp/existing.nitpicker.bak');
		expect(mockFormatCliError).toHaveBeenCalledWith(expect.any(Error), false);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('restores the backup and exits fatally when archive.write() fails', async () => {
		mockArchiveWrite.mockRejectedValue(new Error('disk full'));
		const { viewerBuild } = await import('./viewer-build.js');

		await expect(viewerBuild(['/tmp/existing.nitpicker'], {} as never)).rejects.toThrow(
			ExitError,
		);
		expect(mockCopyFile).toHaveBeenCalledTimes(2);
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
		mockEnsureViewerReadModel.mockRejectedValue(new Error('build broke'));
		mockCopyFile.mockImplementationOnce(() => Promise.resolve()); // backup succeeds
		mockCopyFile.mockImplementationOnce(() =>
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
