import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { tar } from './tar.js';
import { untar } from './untar.js';

describe('untar', () => {
	const testDir = path.join(tmpdir(), 'nitpicker-test-untar');
	const srcDir = path.join(testDir, 'source');
	const extractDir = path.join(testDir, 'extract');

	beforeEach(() => {
		mkdirSync(srcDir, { recursive: true });
		mkdirSync(extractDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('extracts specific files from tar archive', async () => {
		writeFileSync(path.join(srcDir, 'a.txt'), 'aaa');
		writeFileSync(path.join(srcDir, 'b.txt'), 'bbb');
		const tarPath = path.join(testDir, 'archive.tar');
		await tar(srcDir, tarPath);

		await untar(tarPath, { cwd: extractDir, fileList: ['source/a.txt'] });
		expect(existsSync(path.join(extractDir, 'source', 'a.txt'))).toBe(true);
		expect(readFileSync(path.join(extractDir, 'source', 'a.txt'), 'utf8')).toBe('aaa');
	});
});
