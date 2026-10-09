import { readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { outputJSON } from './output-json.js';

describe('outputJSON', () => {
	const testDir = path.join(tmpdir(), 'nitpicker-test-output-json');

	beforeEach(() => {
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('writes JSON data to file with 2-space indentation', async () => {
		const filePath = path.join(testDir, 'data.json');
		await outputJSON(filePath, { key: 'value' });
		const content = readFileSync(filePath, 'utf8');
		expect(JSON.parse(content)).toEqual({ key: 'value' });
		expect(content).toContain('  '); // 2-space indent
	});

	it('creates parent directories if they do not exist', async () => {
		const filePath = path.join(testDir, 'nested', 'dir', 'data.json');
		await outputJSON(filePath, [1, 2, 3]);
		const content = readFileSync(filePath, 'utf8');
		expect(JSON.parse(content)).toEqual([1, 2, 3]);
	});
});
