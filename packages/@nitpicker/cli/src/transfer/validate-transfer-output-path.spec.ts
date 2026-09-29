import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { validateTransferOutputPath } from './validate-transfer-output-path.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const outputFile = path.resolve(workingDir, 'validate-output.nitpicker');
const siblingDir = path.resolve(workingDir, 'validate-output');
const tmpDir = path.resolve(workingDir, '._nitpicker-validate-output');

afterEach(async () => {
	await fs.rm(outputFile, { force: true });
	await fs.rm(siblingDir, { recursive: true, force: true });
	await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('validateTransferOutputPath', () => {
	it('resolves a bare name to an absolute .nitpicker path', async () => {
		await fs.mkdir(workingDir, { recursive: true });
		const resolved = validateTransferOutputPath('validate-output', workingDir);
		expect(resolved).toBe(outputFile);
	});

	it('throws when the output file already exists', async () => {
		await fs.mkdir(workingDir, { recursive: true });
		await fs.writeFile(outputFile, '');
		expect(() => validateTransferOutputPath('validate-output', workingDir)).toThrow(
			/already exists/,
		);
	});

	it('throws when the sibling write-target directory already exists', async () => {
		await fs.mkdir(siblingDir, { recursive: true });
		expect(() => validateTransferOutputPath('validate-output', workingDir)).toThrow(
			/directory already exists/,
		);
	});

	it('throws when a stale tmpDir already exists', async () => {
		await fs.mkdir(tmpDir, { recursive: true });
		expect(() => validateTransferOutputPath('validate-output', workingDir)).toThrow(
			/stale working directory/,
		);
	});
});
