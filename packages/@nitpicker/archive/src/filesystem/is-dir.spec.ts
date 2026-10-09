import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isDir } from './is-dir.js';

describe('isDir', () => {
	const testDir = path.join(tmpdir(), 'nitpicker-test-is-dir');

	beforeEach(() => {
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('returns true for a directory', async () => {
		expect(await isDir(testDir)).toBe(true);
	});

	it('returns false for a file', async () => {
		const filePath = path.join(testDir, 'file.txt');
		writeFileSync(filePath, '');
		expect(await isDir(filePath)).toBe(false);
	});
});
