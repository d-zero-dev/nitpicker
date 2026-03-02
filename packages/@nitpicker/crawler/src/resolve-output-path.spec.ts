import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveOutputPath } from './resolve-output-path.js';

describe('resolveOutputPath', () => {
	const testDir = path.join(tmpdir(), 'nitpicker-test-resolve-output-path');

	beforeEach(() => {
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('resolves a relative path to absolute using cwd', () => {
		const result = resolveOutputPath('output.nitpicker', testDir);
		expect(result).toBe(path.join(testDir, 'output.nitpicker'));
	});

	it('keeps an absolute path as-is', () => {
		const absPath = path.join(testDir, 'output.nitpicker');
		const result = resolveOutputPath(absPath, '/some/other/dir');
		expect(result).toBe(absPath);
	});

	it('appends .nitpicker extension when missing', () => {
		const result = resolveOutputPath('my-archive', testDir);
		expect(result).toBe(path.join(testDir, 'my-archive.nitpicker'));
	});

	it('does not double-append .nitpicker extension', () => {
		const result = resolveOutputPath('my-archive.nitpicker', testDir);
		expect(result).toBe(path.join(testDir, 'my-archive.nitpicker'));
	});

	it('resolves nested relative paths', () => {
		const subDir = path.join(testDir, 'sub');
		mkdirSync(subDir, { recursive: true });
		const result = resolveOutputPath('sub/output.nitpicker', testDir);
		expect(result).toBe(path.join(testDir, 'sub', 'output.nitpicker'));
	});

	it('throws when parent directory does not exist', () => {
		expect(() => resolveOutputPath('/nonexistent/dir/output.nitpicker', testDir)).toThrow(
			'Output directory does not exist: /nonexistent/dir',
		);
	});

	it('throws with a helpful message for missing parent directory', () => {
		expect(() =>
			resolveOutputPath('nonexistent-subdir/output.nitpicker', testDir),
		).toThrow('Please create the directory before running the command.');
	});
});
