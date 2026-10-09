import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readJSON } from './read-json.js';

describe('readJSON', () => {
	const testDir = path.join(tmpdir(), 'nitpicker-test-read-json');

	beforeEach(() => {
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('reads and parses JSON from file', async () => {
		const filePath = path.join(testDir, 'data.json');
		writeFileSync(filePath, JSON.stringify({ foo: 'bar' }));
		const result = await readJSON<{ foo: string }>(filePath);
		expect(result).toEqual({ foo: 'bar' });
	});
});
