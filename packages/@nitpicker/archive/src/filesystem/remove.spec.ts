import { writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { remove } from './remove.js';

describe('remove', () => {
	const testDir = path.join(tmpdir(), 'nitpicker-test-remove');

	beforeEach(() => {
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('removes a file', async () => {
		const filePath = path.join(testDir, 'file.txt');
		writeFileSync(filePath, 'data');
		await remove(filePath);
		expect(existsSync(filePath)).toBe(false);
	});

	it('removes a directory recursively', async () => {
		const subDir = path.join(testDir, 'sub');
		mkdirSync(subDir);
		writeFileSync(path.join(subDir, 'file.txt'), 'data');
		await remove(subDir);
		expect(existsSync(subDir)).toBe(false);
	});
});
