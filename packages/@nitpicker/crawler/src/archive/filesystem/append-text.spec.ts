import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appendText } from './append-text.js';

describe('appendText', () => {
	const testDir = path.join(tmpdir(), 'nitpicker-test-append-text');

	beforeEach(() => {
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('appends text with a preceding newline', async () => {
		const filePath = path.join(testDir, 'file.txt');
		writeFileSync(filePath, 'line1');
		await appendText(filePath, 'line2');
		expect(readFileSync(filePath, 'utf8')).toBe('line1\nline2');
	});
});
