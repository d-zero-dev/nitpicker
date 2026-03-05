import {
	promises as fs,
	writeFileSync,
	readFileSync,
	existsSync,
	mkdirSync,
	rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

	it('falls back to cp+remove when fs.rename throws EPERM', async () => {
		const oldPath = path.join(testDir, 'old.txt');
		const newPath = path.join(testDir, 'new.txt');
		writeFileSync(oldPath, 'data');

		const eperm = Object.assign(new Error('EPERM'), { code: 'EPERM' });
		const spy = vi.spyOn(fs, 'rename').mockRejectedValueOnce(eperm);

		await rename(oldPath, newPath);

		expect(existsSync(newPath)).toBe(true);
		expect(readFileSync(newPath, 'utf8')).toBe('data');
		expect(existsSync(oldPath)).toBe(false);
		spy.mockRestore();
	});

	it('falls back to cp+remove when fs.rename throws EPERM with override', async () => {
		const oldPath = path.join(testDir, 'old.txt');
		const newPath = path.join(testDir, 'new.txt');
		writeFileSync(oldPath, 'new data');
		writeFileSync(newPath, 'old data');

		const eperm = Object.assign(new Error('EPERM'), { code: 'EPERM' });
		const spy = vi.spyOn(fs, 'rename').mockRejectedValueOnce(eperm);

		await rename(oldPath, newPath, true);

		expect(readFileSync(newPath, 'utf8')).toBe('new data');
		expect(existsSync(oldPath)).toBe(false);
		spy.mockRestore();
	});

	it('falls back to cp+remove when fs.rename throws EXDEV', async () => {
		const oldDir = path.join(testDir, 'src-dir');
		const newDir = path.join(testDir, 'dst-dir');
		mkdirSync(oldDir, { recursive: true });
		writeFileSync(path.join(oldDir, 'file.txt'), 'hello');

		const exdev = Object.assign(new Error('EXDEV'), { code: 'EXDEV' });
		const spy = vi.spyOn(fs, 'rename').mockRejectedValueOnce(exdev);

		await rename(oldDir, newDir);

		expect(existsSync(path.join(newDir, 'file.txt'))).toBe(true);
		expect(readFileSync(path.join(newDir, 'file.txt'), 'utf8')).toBe('hello');
		expect(existsSync(oldDir)).toBe(false);
		spy.mockRestore();
	});

	it('cleans up partial copy and re-throws when fs.cp fails during fallback', async () => {
		const oldPath = path.join(testDir, 'old.txt');
		const newPath = path.join(testDir, 'new.txt');
		writeFileSync(oldPath, 'data');

		const eperm = Object.assign(new Error('EPERM'), { code: 'EPERM' });
		const renameSpy = vi.spyOn(fs, 'rename').mockRejectedValueOnce(eperm);
		const cpSpy = vi.spyOn(fs, 'cp').mockRejectedValueOnce(new Error('disk full'));

		await expect(rename(oldPath, newPath)).rejects.toThrow('disk full');

		expect(existsSync(oldPath)).toBe(true);
		expect(existsSync(newPath)).toBe(false);
		renameSpy.mockRestore();
		cpSpy.mockRestore();
	});

	it('re-throws non-EPERM/EXDEV errors', async () => {
		const oldPath = path.join(testDir, 'old.txt');
		const newPath = path.join(testDir, 'new.txt');
		writeFileSync(oldPath, 'data');

		const eacces = Object.assign(new Error('EACCES'), { code: 'EACCES' });
		const spy = vi.spyOn(fs, 'rename').mockRejectedValueOnce(eacces);

		await expect(rename(oldPath, newPath)).rejects.toThrow('EACCES');
		spy.mockRestore();
	});

	it('re-throws when error is not an Error instance', async () => {
		const oldPath = path.join(testDir, 'old.txt');
		const newPath = path.join(testDir, 'new.txt');
		writeFileSync(oldPath, 'data');

		const spy = vi.spyOn(fs, 'rename').mockRejectedValueOnce('string error');

		await expect(rename(oldPath, newPath)).rejects.toBe('string error');
		spy.mockRestore();
	});
});
