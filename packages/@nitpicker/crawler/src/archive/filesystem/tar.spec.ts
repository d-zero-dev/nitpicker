import { writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { tar } from './tar.js';
import { untar } from './untar.js';

describe('tar', () => {
	const testDir = path.join(tmpdir(), 'nitpicker-test-tar');
	const srcDir = path.join(testDir, 'source');
	const extractDir = path.join(testDir, 'extract');

	beforeEach(() => {
		mkdirSync(srcDir, { recursive: true });
		mkdirSync(extractDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('creates and extracts a tar archive', async () => {
		writeFileSync(path.join(srcDir, 'test.txt'), 'hello tar');
		const tarPath = path.join(testDir, 'archive.tar');
		await tar(srcDir, tarPath);
		expect(existsSync(tarPath)).toBe(true);

		await untar(tarPath, { cwd: extractDir });
		expect(existsSync(path.join(extractDir, 'source', 'test.txt'))).toBe(true);
	});
});
