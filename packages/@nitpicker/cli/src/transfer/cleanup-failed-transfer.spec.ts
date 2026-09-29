import fs from 'node:fs/promises';
import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { afterEach, describe, expect, it } from 'vitest';

import { cleanupFailedTransfer } from './cleanup-failed-transfer.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');
const outputPath = path.resolve(workingDir, 'cleanup-failed-output.nitpicker');

afterEach(async () => {
	await fs.rm(outputPath, { force: true });
	await fs.rm(path.resolve(workingDir, '._nitpicker-cleanup-failed-output'), {
		recursive: true,
		force: true,
	});
	await fs.rm(path.resolve(workingDir, 'cleanup-failed-output'), {
		recursive: true,
		force: true,
	});
});

describe('cleanupFailedTransfer', () => {
	it('removes the destination tmpDir WITHOUT writing the output file (releaseHandle, never close)', async () => {
		const destination = await Archive.create({ filePath: outputPath, cwd: workingDir });
		const tmpDir = destination.tmpDir;
		await fs.access(tmpDir); // sanity: tmpDir exists before cleanup

		await cleanupFailedTransfer({
			sourceAccessors: [],
			destination,
			writeStarted: false,
			outputPath,
		});

		await expect(fs.access(tmpDir)).rejects.toThrow();
		// The critical assertion: if this had called close() instead of
		// releaseHandle(), the recovery-write path would have packaged the
		// half-built tmpDir into a real output file. It must not exist.
		await expect(fs.access(outputPath)).rejects.toThrow();
	});

	it('releases the lock so a fresh Archive.create can reuse the same output path', async () => {
		const destination = await Archive.create({ filePath: outputPath, cwd: workingDir });
		await cleanupFailedTransfer({
			sourceAccessors: [],
			destination,
			writeStarted: false,
			outputPath,
		});

		const retry = await Archive.create({ filePath: outputPath, cwd: workingDir });
		await retry.releaseHandle();
	});

	it('removes the write-target sibling directory and a partially-written output file once write() has started', async () => {
		const destination = await Archive.create({ filePath: outputPath, cwd: workingDir });
		// Simulate archive.write()'s own sequence having gotten partway
		// through: it renames tmpDir to `<dir>/<basename>` (no extension)
		// before tarring to `outputPath` — model both as stray leftovers a
		// failure mid-`write()` could plausibly leave behind.
		const basename = path.basename(outputPath, path.extname(outputPath));
		const siblingDir = path.join(workingDir, basename);
		await fs.mkdir(siblingDir, { recursive: true });
		await fs.writeFile(path.join(siblingDir, 'db.sqlite'), 'partial');
		await fs.writeFile(outputPath, 'truncated tar');

		await cleanupFailedTransfer({
			sourceAccessors: [],
			destination,
			writeStarted: true,
			outputPath,
		});

		await expect(fs.access(siblingDir)).rejects.toThrow();
		await expect(fs.access(outputPath)).rejects.toThrow();
	});

	it('leaves no write-target leftovers to clean up when writeStarted is false (nothing was ever written)', async () => {
		const destination = await Archive.create({ filePath: outputPath, cwd: workingDir });
		const basename = path.basename(outputPath, path.extname(outputPath));
		const siblingDir = path.join(workingDir, basename);

		await cleanupFailedTransfer({
			sourceAccessors: [],
			destination,
			writeStarted: false,
			outputPath,
		});

		// Nothing should have been created by this run at all — the
		// `writeStarted: false` branch does not even attempt to touch
		// `outputPath`/`siblingDir`.
		await expect(fs.access(siblingDir)).rejects.toThrow();
		await expect(fs.access(outputPath)).rejects.toThrow();
	});

	it('closes every source accessor without throwing even if one is already closed', async () => {
		const source = await Archive.create({
			filePath: path.resolve(workingDir, 'cleanup-failed-source.nitpicker'),
			cwd: workingDir,
		});
		await source.releaseHandle();

		await expect(
			cleanupFailedTransfer({
				sourceAccessors: [source],
				destination: null,
				writeStarted: false,
				outputPath,
			}),
		).resolves.toBeUndefined();

		await fs.rm(path.resolve(workingDir, 'cleanup-failed-source.nitpicker'), {
			force: true,
		});
		await fs.rm(path.resolve(workingDir, '._nitpicker-cleanup-failed-source'), {
			recursive: true,
			force: true,
		});
	});
});
