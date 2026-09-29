import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { validateTransferInputPaths } from './validate-transfer-input-paths.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const fileA = path.resolve(workingDir, 'validate-input-a.nitpicker');
const fileB = path.resolve(workingDir, 'validate-input-b.nitpicker');
const stubDir = path.resolve(workingDir, 'validate-input-stub.nitpicker');
const wrongExt = path.resolve(workingDir, 'validate-input.txt');

afterEach(async () => {
	await fs.rm(fileA, { force: true });
	await fs.rm(fileB, { force: true });
	await fs.rm(stubDir, { recursive: true, force: true });
	await fs.rm(wrongExt, { force: true });
});

describe('validateTransferInputPaths', () => {
	it('resolves relative paths to absolute and returns them in order', async () => {
		await fs.mkdir(workingDir, { recursive: true });
		await fs.writeFile(fileA, '');
		await fs.writeFile(fileB, '');
		const result = validateTransferInputPaths(
			[path.relative(workingDir, fileA), fileB],
			workingDir,
		);
		expect(result).toEqual([fileA, fileB]);
	});

	it('throws when a path does not exist', () => {
		expect(() => validateTransferInputPaths([fileA], workingDir)).toThrow(/not found/);
	});

	it('throws for a stub directory instead of a file', async () => {
		await fs.mkdir(stubDir, { recursive: true });
		expect(() => validateTransferInputPaths([stubDir], workingDir)).toThrow(
			/stub crawl directories/,
		);
	});

	it('throws for the wrong extension', async () => {
		await fs.mkdir(workingDir, { recursive: true });
		await fs.writeFile(wrongExt, '');
		expect(() => validateTransferInputPaths([wrongExt], workingDir)).toThrow(
			/Not a \.nitpicker file/,
		);
	});

	it('throws when the same archive is given twice', async () => {
		await fs.mkdir(workingDir, { recursive: true });
		await fs.writeFile(fileA, '');
		expect(() => validateTransferInputPaths([fileA, fileA], workingDir)).toThrow(
			/given twice/,
		);
	});
});
