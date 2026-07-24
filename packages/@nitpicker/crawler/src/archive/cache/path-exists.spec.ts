import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pathExists } from './path-exists.js';

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nitpicker-path-exists-test-'));
});

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('pathExists', () => {
	it('returns true for an existing file', async () => {
		const filePath = path.join(tmpDir, 'file.txt');
		await fs.writeFile(filePath, 'content');
		await expect(pathExists(filePath)).resolves.toBe(true);
	});

	it('returns true for an existing directory', async () => {
		const dirPath = path.join(tmpDir, 'sub');
		await fs.mkdir(dirPath);
		await expect(pathExists(dirPath)).resolves.toBe(true);
	});

	it('returns false for a path that does not exist', async () => {
		await expect(pathExists(path.join(tmpDir, 'missing'))).resolves.toBe(false);
	});
});
