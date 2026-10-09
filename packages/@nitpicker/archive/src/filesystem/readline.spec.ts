import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readline } from './readline.js';

describe('readline', () => {
	const testDir = path.join(tmpdir(), 'nitpicker-test-readline');

	beforeEach(() => {
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('invokes callback for each line', async () => {
		const filePath = path.join(testDir, 'lines.txt');
		writeFileSync(filePath, 'line1\nline2\nline3');
		const lines: string[] = [];
		await readline(filePath, (line) => {
			lines.push(line);
		});
		expect(lines).toEqual(['line1', 'line2', 'line3']);
	});
});
