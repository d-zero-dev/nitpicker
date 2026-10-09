import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readText } from './read-text.js';

describe('readText', () => {
	const testDir = path.join(tmpdir(), 'nitpicker-test-read-text');

	beforeEach(() => {
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('reads text content from file', async () => {
		const filePath = path.join(testDir, 'file.txt');
		writeFileSync(filePath, 'test content');
		expect(await readText(filePath)).toBe('test content');
	});
});
