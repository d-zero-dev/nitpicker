import { existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { mkdir } from './mkdir.js';

describe('mkdir', () => {
	const testDir = path.join(tmpdir(), 'nitpicker-test-mkdir');

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('creates parent directory if it does not exist', () => {
		const filePath = path.join(testDir, 'sub', 'file.txt');
		mkdir(filePath);
		expect(existsSync(path.join(testDir, 'sub'))).toBe(true);
	});

	it('does nothing if directory already exists', () => {
		const filePath = path.join(testDir, 'sub', 'file.txt');
		mkdir(filePath);
		mkdir(filePath); // second call should not throw
		expect(existsSync(path.join(testDir, 'sub'))).toBe(true);
	});

	it('creates directory with 0o700 permissions', () => {
		const filePath = path.join(testDir, 'secure', 'file.txt');
		mkdir(filePath);
		const stats = statSync(path.join(testDir, 'secure'));

		const mode = stats.mode & 0o777;
		expect(mode).toBe(0o700);
	});
});
