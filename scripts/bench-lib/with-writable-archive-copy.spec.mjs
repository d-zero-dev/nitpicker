import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const archiveOpen = vi.fn();

vi.mock('@nitpicker/archive/archive', () => ({
	default: { open: (...args) => archiveOpen(...args) },
}));

const { withWritableArchiveCopy } = await import('./with-writable-archive-copy.mjs');

describe('withWritableArchiveCopy', () => {
	beforeEach(() => {
		archiveOpen.mockReset();
	});

	it('opens the archive into a fresh temp directory and deletes it after the work', async () => {
		const archive = { releaseHandle: vi.fn(async () => {}) };
		archiveOpen.mockResolvedValue(archive);
		let workDir;
		const result = await withWritableArchiveCopy('site.nitpicker', async (opened) => {
			workDir = archiveOpen.mock.calls[0][0].cwd;
			expect(opened).toBe(archive);
			expect(existsSync(workDir)).toBe(true);
			return 'measured';
		});
		expect(result).toBe('measured');
		expect(archiveOpen.mock.calls[0][0].filePath).toBe(path.resolve('site.nitpicker'));
		expect(path.dirname(workDir)).toBe(tmpdir());
		expect(path.basename(workDir)).toMatch(/^nitpicker-bench-/);
		expect(archive.releaseHandle).toHaveBeenCalledOnce();
		expect(existsSync(workDir)).toBe(false);
	});

	it('deletes the temp directory even when releasing the handle fails', async () => {
		archiveOpen.mockResolvedValue({
			releaseHandle: async () => {
				throw new Error('release failed');
			},
		});
		await expect(
			withWritableArchiveCopy('site.nitpicker', async () => 'x'),
		).rejects.toThrow('release failed');
		expect(existsSync(archiveOpen.mock.calls[0][0].cwd)).toBe(false);
	});

	it('deletes the temp directory when the archive cannot be opened', async () => {
		archiveOpen.mockRejectedValue(new Error('not a tar'));
		await expect(
			withWritableArchiveCopy('site.nitpicker', async () => 'x'),
		).rejects.toThrow('not a tar');
		expect(existsSync(archiveOpen.mock.calls[0][0].cwd)).toBe(false);
	});

	it('rethrows the work error after cleaning up', async () => {
		const archive = { releaseHandle: vi.fn(async () => {}) };
		archiveOpen.mockResolvedValue(archive);
		await expect(
			withWritableArchiveCopy('site.nitpicker', async () => {
				throw new Error('bench failed');
			}),
		).rejects.toThrow('bench failed');
		expect(archive.releaseHandle).toHaveBeenCalledOnce();
		expect(existsSync(archiveOpen.mock.calls[0][0].cwd)).toBe(false);
	});
});
