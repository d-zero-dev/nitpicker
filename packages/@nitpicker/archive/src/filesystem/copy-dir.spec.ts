import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { copyDir } from './copy-dir.js';

describe('copyDir', () => {
	const testDir = path.join(tmpdir(), 'nitpicker-test-copy-dir');
	const srcDir = path.join(testDir, 'src');
	const destDir = path.join(testDir, 'dest');

	beforeEach(() => {
		mkdirSync(srcDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('copies directory contents', async () => {
		writeFileSync(path.join(srcDir, 'a.txt'), 'hello');
		const result = await copyDir(srcDir, destDir);
		expect(result).toBe(true);
		expect(readFileSync(path.join(destDir, 'a.txt'), 'utf8')).toBe('hello');
	});

	it('returns false on error', async () => {
		const result = await copyDir('/nonexistent/path', destDir);
		expect(result).toBe(false);
	});
});
