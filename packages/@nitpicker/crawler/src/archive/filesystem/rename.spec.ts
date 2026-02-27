import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { rename } from './rename.js';

describe('rename', () => {
	const testDir = path.join(tmpdir(), 'nitpicker-test-rename');

	beforeEach(() => {
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('renames a file', async () => {
		const oldPath = path.join(testDir, 'old.txt');
		const newPath = path.join(testDir, 'new.txt');
		writeFileSync(oldPath, 'data');
		await rename(oldPath, newPath);
		expect(existsSync(newPath)).toBe(true);
		expect(existsSync(oldPath)).toBe(false);
	});

	it('overrides existing file when override is true', async () => {
		const oldPath = path.join(testDir, 'old.txt');
		const newPath = path.join(testDir, 'new.txt');
		writeFileSync(oldPath, 'new data');
		writeFileSync(newPath, 'old data');
		await rename(oldPath, newPath, true);
		expect(readFileSync(newPath, 'utf8')).toBe('new data');
	});

	it('succeeds with override true when destination does not exist', async () => {
		const oldPath = path.join(testDir, 'old.txt');
		const newPath = path.join(testDir, 'new.txt');
		writeFileSync(oldPath, 'data');
		await rename(oldPath, newPath, true);
		expect(existsSync(newPath)).toBe(true);
		expect(readFileSync(newPath, 'utf8')).toBe('data');
	});
});
