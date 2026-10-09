import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import Archive from '../archive.js';

import { copyInventorySourceLists } from './copy-inventory-source-lists.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const outputPath = path.resolve(workingDir, 'copy-inventory-lists-output.nitpicker');
const sourceTmpDir = path.resolve(workingDir, 'copy-inventory-lists-source-tmp');

afterEach(async () => {
	await fs.rm(outputPath, { force: true });
	await fs.rm(sourceTmpDir, { recursive: true, force: true });
	await fs.rm(path.resolve(workingDir, '._nitpicker-copy-inventory-lists-output'), {
		recursive: true,
		force: true,
	});
});

describe('copyInventorySourceLists', () => {
	it('copies only correctly-named inventory files, deduplicating by name across sources', async () => {
		const sha = 'a'.repeat(64);
		await fs.mkdir(path.join(sourceTmpDir, 'inventory'), { recursive: true });
		await fs.writeFile(
			path.join(sourceTmpDir, 'inventory', `${sha}.txt`),
			'https://example.com/\n',
		);
		await fs.writeFile(path.join(sourceTmpDir, 'inventory', 'not-a-hash.txt'), 'ignored');

		const destination = await Archive.create({ filePath: outputPath, cwd: workingDir });
		try {
			const copied = await copyInventorySourceLists(destination, [
				sourceTmpDir,
				sourceTmpDir,
			]);
			expect(copied).toBe(1);
			const bytes = await fs.readFile(
				path.join(destination.tmpDir, 'inventory', `${sha}.txt`),
			);
			expect(bytes.toString()).toBe('https://example.com/\n');
		} finally {
			await destination.releaseHandle();
		}
	});

	it('returns 0 when no source has an inventory directory', async () => {
		await fs.mkdir(sourceTmpDir, { recursive: true });
		const destination = await Archive.create({ filePath: outputPath, cwd: workingDir });
		try {
			const copied = await copyInventorySourceLists(destination, [sourceTmpDir]);
			expect(copied).toBe(0);
		} finally {
			await destination.releaseHandle();
		}
	});
});
