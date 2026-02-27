import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { outputText } from './output-text.js';

describe('outputText', () => {
	const testDir = path.join(tmpdir(), 'nitpicker-test-output-text');

	beforeEach(() => {
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('writes text to file', async () => {
		const filePath = path.join(testDir, 'file.txt');
		await outputText(filePath, 'hello world');
		expect(readFileSync(filePath, 'utf8')).toBe('hello world');
	});

	it('creates parent directories if needed', async () => {
		const filePath = path.join(testDir, 'sub', 'file.txt');
		await outputText(filePath, 'nested');
		expect(readFileSync(filePath, 'utf8')).toBe('nested');
	});
});
