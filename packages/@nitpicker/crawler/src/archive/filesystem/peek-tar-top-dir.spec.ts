import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { peekTarTopDir } from './peek-tar-top-dir.js';
import { tar } from './tar.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_peek_tar_top_dir__');

const created: string[] = [];

afterEach(async () => {
	while (created.length > 0) {
		await fs.rm(created.pop()!, { recursive: true, force: true });
	}
});

/**
 * Builds a tar file by tarring a directory with a known inner name. Mirrors
 * `Archive.write()`'s shape: a top-level directory containing a single file.
 * @param innerDirName
 * @param content
 */
async function buildTar(innerDirName: string, content: string): Promise<string> {
	await fs.mkdir(workingDir, { recursive: true });
	const sourceDir = path.resolve(workingDir, innerDirName);
	await fs.mkdir(sourceDir, { recursive: true });
	await fs.writeFile(path.resolve(sourceDir, 'db.sqlite'), content);
	const tarPath = path.resolve(workingDir, `${innerDirName}.nitpicker`);
	await tar(sourceDir, tarPath);
	await fs.rm(sourceDir, { recursive: true, force: true });
	created.push(tarPath);
	return tarPath;
}

describe('peekTarTopDir', () => {
	it('returns the top-level directory name from a tar', async () => {
		const tarPath = await buildTar('archive-name', 'hello');
		expect(await peekTarTopDir(tarPath)).toBe('archive-name');
	});

	it('returns the directory name even when it differs from the file basename', async () => {
		// Simulates the user-rename scenario: tar was written with one
		// inner-dir name, but the outer file was later renamed to something
		// else. The function must return the *actual* inner name.
		const tarPath = await buildTar('original-name', 'x');
		const renamed = tarPath.replace('original-name.nitpicker', 'renamed.nitpicker');
		await fs.rename(tarPath, renamed);
		created.pop();
		created.push(renamed);
		expect(await peekTarTopDir(renamed)).toBe('original-name');
	});

	it('handles names with dots and dashes correctly', async () => {
		const tarPath = await buildTar('www.example.com-20260101120000', 'x');
		expect(await peekTarTopDir(tarPath)).toBe('www.example.com-20260101120000');
	});

	it('skips AppleDouble (`._*`) entries from macOS BSD tar', async () => {
		// Build a tar that mirrors what macOS BSD `tar -cf` produces: a
		// File entry `._dirname` (AppleDouble resource fork) at the tar
		// root, then the real Directory entry. Node's `tar` library
		// surfaces both — `tar -tf` on BSD hides the AppleDouble — so the
		// helper must filter the File to find the actual inner directory.
		await fs.mkdir(workingDir, { recursive: true });
		const tarPath = path.resolve(workingDir, 'apple-double-fixture.nitpicker');
		const { c: createTar } = await import('tar');
		const sourceDir = path.resolve(workingDir, 'real-name');
		await fs.mkdir(sourceDir, { recursive: true });
		await fs.writeFile(path.resolve(sourceDir, 'db.sqlite'), 'x');
		const appleDouble = path.resolve(workingDir, '._real-name');
		await fs.writeFile(appleDouble, Buffer.from([0x00, 0x05, 0x16, 0x07]));
		await createTar({ file: tarPath, cwd: workingDir, portable: true }, [
			'._real-name',
			'real-name',
		]);
		await fs.rm(sourceDir, { recursive: true, force: true });
		await fs.rm(appleDouble, { force: true });
		created.push(tarPath);
		expect(await peekTarTopDir(tarPath)).toBe('real-name');
	});
});
