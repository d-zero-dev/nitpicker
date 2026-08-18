import path from 'node:path';

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

const mockExistsSync = vi.fn();
const mockStatSync = vi.fn();

vi.mock('node:fs', () => ({
	existsSync: mockExistsSync,
	statSync: mockStatSync,
}));

const mockGetArchiveCacheRoot = vi.fn(() => '/mock-cache-root');
const mockListArchiveCacheEntries = vi.fn().mockResolvedValue([]);
const mockClearArchiveCacheRoot = vi.fn().mockResolvedValue(true);
const mockClearArchiveCacheEntry = vi.fn().mockResolvedValue(true);
const mockComputeArchiveCacheKey = vi.fn().mockResolvedValue('cache-key-123');
const mockResolveArchiveCacheDir = vi.fn(() => '/mock-cache-root/cache-key-123-example');

vi.mock('@nitpicker/crawler', () => ({
	getArchiveCacheRoot: mockGetArchiveCacheRoot,
	listArchiveCacheEntries: mockListArchiveCacheEntries,
	clearArchiveCacheRoot: mockClearArchiveCacheRoot,
	clearArchiveCacheEntry: mockClearArchiveCacheEntry,
	computeArchiveCacheKey: mockComputeArchiveCacheKey,
	resolveArchiveCacheDir: mockResolveArchiveCacheDir,
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

describe('cache command', () => {
	let exitSpy: ReturnType<typeof vi.spyOn>;
	let consoleLogSpy: ReturnType<typeof vi.spyOn>;
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockGetArchiveCacheRoot.mockReturnValue('/mock-cache-root');
		mockListArchiveCacheEntries.mockResolvedValue([]);
		mockClearArchiveCacheRoot.mockResolvedValue(true);
		mockClearArchiveCacheEntry.mockResolvedValue(true);
		mockComputeArchiveCacheKey.mockResolvedValue('cache-key-123');
		mockResolveArchiveCacheDir.mockReturnValue('/mock-cache-root/cache-key-123-example');
		mockExistsSync.mockReturnValue(true);
		mockStatSync.mockReturnValue({ isFile: () => true });

		exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new ExitError(code as number);
		});
		consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('exits with error when no sub-command is provided', async () => {
		const { cache } = await import('./cache.js');
		await expect(cache([], {} as never)).rejects.toThrow(ExitError);

		expect(consoleErrorSpy).toHaveBeenCalledWith('Error: No sub-command specified.');
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it('exits with error for an unknown sub-command', async () => {
		const { cache } = await import('./cache.js');
		await expect(cache(['purge'], {} as never)).rejects.toThrow(ExitError);

		expect(consoleErrorSpy).toHaveBeenCalledWith('Error: Unknown sub-command: purge');
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	describe('list', () => {
		it('resolves the cache root and lists entries as human-readable text by default', async () => {
			mockListArchiveCacheEntries.mockResolvedValue([
				{
					kind: 'tar-cache',
					name: '12345-abcd-example',
					path: '/mock-cache-root/12345-abcd-example',
					sizeBytes: 1024,
					mtimeMs: Date.now(),
				},
			]);
			const { cache } = await import('./cache.js');
			await cache(['list'], {} as never);

			expect(mockGetArchiveCacheRoot).toHaveBeenCalledOnce();
			expect(mockListArchiveCacheEntries).toHaveBeenCalledWith('/mock-cache-root');
			expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('tar-cache'));
		});

		it('outputs JSON when --json is passed', async () => {
			const entries = [
				{
					kind: 'table',
					name: 'table',
					path: '/mock-cache-root/table',
					sizeBytes: 2048,
					mtimeMs: Date.now(),
				},
			];
			mockListArchiveCacheEntries.mockResolvedValue(entries);
			const { cache } = await import('./cache.js');
			await cache(['list'], { json: true } as never);

			expect(consoleLogSpy).toHaveBeenCalledWith(JSON.stringify(entries));
		});

		it('reports no entries found when the list is empty', async () => {
			const { cache } = await import('./cache.js');
			await cache(['list'], {} as never);

			expect(consoleLogSpy).toHaveBeenCalledWith(
				expect.stringContaining('No cache entries found'),
			);
		});

		it('exits fatally when listing fails', async () => {
			mockListArchiveCacheEntries.mockRejectedValue(new Error('disk error'));
			const { cache } = await import('./cache.js');

			await expect(cache(['list'], {} as never)).rejects.toThrow(ExitError);
			expect(mockFormatCliError).toHaveBeenCalledWith(expect.any(Error), false);
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
	});

	describe('clear (no archive argument)', () => {
		it('clears the entire cache root and reports success', async () => {
			mockClearArchiveCacheRoot.mockResolvedValue(true);
			const { cache } = await import('./cache.js');
			await cache(['clear'], {} as never);

			expect(mockClearArchiveCacheRoot).toHaveBeenCalledWith('/mock-cache-root');
			expect(mockExistsSync).not.toHaveBeenCalled();
			expect(mockComputeArchiveCacheKey).not.toHaveBeenCalled();
			expect(consoleLogSpy).toHaveBeenCalledWith(
				expect.stringContaining('Removed cache root'),
			);
		});

		it('reports that the cache root was already empty', async () => {
			mockClearArchiveCacheRoot.mockResolvedValue(false);
			const { cache } = await import('./cache.js');
			await cache(['clear'], {} as never);

			expect(consoleLogSpy).toHaveBeenCalledWith(
				expect.stringContaining('did not exist (already empty)'),
			);
		});

		it('exits fatally when clearing the root fails', async () => {
			mockClearArchiveCacheRoot.mockRejectedValue(new Error('permission denied'));
			const { cache } = await import('./cache.js');

			await expect(cache(['clear'], {} as never)).rejects.toThrow(ExitError);
			expect(mockFormatCliError).toHaveBeenCalledWith(expect.any(Error), false);
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
	});

	describe('clear <archive>', () => {
		it('resolves a relative archive path against process.cwd()', async () => {
			const { cache } = await import('./cache.js');
			await cache(['clear', 'site.nitpicker'], {} as never);

			const expectedAbsPath = path.resolve(process.cwd(), 'site.nitpicker');
			expect(mockExistsSync).toHaveBeenCalledWith(expectedAbsPath);
		});

		it('reports "not found" without touching cache functions when the archive is missing', async () => {
			mockExistsSync.mockReturnValue(false);
			const { cache } = await import('./cache.js');
			await cache(['clear', '/tmp/missing.nitpicker'], {} as never);

			expect(consoleLogSpy).toHaveBeenCalledWith(
				expect.stringContaining('Archive not found'),
			);
			expect(mockComputeArchiveCacheKey).not.toHaveBeenCalled();
			expect(mockClearArchiveCacheEntry).not.toHaveBeenCalled();
			expect(exitSpy).not.toHaveBeenCalled();
		});

		it('exits with error when the path is a directory (e.g. a stub crawl dir)', async () => {
			mockStatSync.mockReturnValue({ isFile: () => false });
			const { cache } = await import('./cache.js');

			await expect(cache(['clear', '/tmp/some-stub-dir'], {} as never)).rejects.toThrow(
				ExitError,
			);
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining('Not a .nitpicker file'),
			);
			expect(mockComputeArchiveCacheKey).not.toHaveBeenCalled();
			expect(exitSpy).toHaveBeenCalledWith(1);
		});

		it('computes the cache key, resolves the cache dir, and clears only that entry', async () => {
			const { cache } = await import('./cache.js');
			await cache(['clear', '/tmp/existing.nitpicker'], {} as never);

			expect(mockComputeArchiveCacheKey).toHaveBeenCalledWith('/tmp/existing.nitpicker');
			expect(mockResolveArchiveCacheDir).toHaveBeenCalledWith(
				'/mock-cache-root',
				'cache-key-123',
				'/tmp/existing.nitpicker',
			);
			expect(mockClearArchiveCacheEntry).toHaveBeenCalledWith(
				'/mock-cache-root/cache-key-123-example',
			);
			expect(consoleLogSpy).toHaveBeenCalledWith(
				expect.stringContaining('Removed cache entry'),
			);
		});

		it('warns about content-addressed lookup limits when no matching entry is found', async () => {
			mockClearArchiveCacheEntry.mockResolvedValue(false);
			const { cache } = await import('./cache.js');
			await cache(['clear', '/tmp/existing.nitpicker'], {} as never);

			expect(consoleLogSpy).toHaveBeenCalledWith(
				expect.stringContaining('content-addressed lookup'),
			);
		});

		it('exits fatally when computing the cache key fails', async () => {
			mockComputeArchiveCacheKey.mockRejectedValue(new Error('stat failed'));
			const { cache } = await import('./cache.js');

			await expect(
				cache(['clear', '/tmp/existing.nitpicker'], {} as never),
			).rejects.toThrow(ExitError);
			expect(mockFormatCliError).toHaveBeenCalledWith(expect.any(Error), false);
			expect(exitSpy).toHaveBeenCalledWith(1);
		});

		it('never calls clearArchiveCacheRoot (must not sweep the table cache along with a single archive)', async () => {
			const { cache } = await import('./cache.js');
			await cache(['clear', '/tmp/existing.nitpicker'], {} as never);

			expect(mockClearArchiveCacheRoot).not.toHaveBeenCalled();
		});
	});

	describe('commandDef sub-command metadata', () => {
		it('lists exactly the dispatchable sub-commands', async () => {
			const { commandDef } = await import('./cache-def.js');

			expect(Object.keys(commandDef.subCommands).toSorted()).toEqual(['clear', 'list']);
		});

		it('references only defined flags in every sub-command flag list', async () => {
			const { commandDef } = await import('./cache-def.js');
			const flagKeys = new Set(Object.keys(commandDef.flags));

			for (const [name, sub] of Object.entries(commandDef.subCommands)) {
				for (const key of sub.flags) {
					expect(flagKeys.has(key), `sub-command ${name} references ${key}`).toBe(true);
				}
			}
		});
	});
});
