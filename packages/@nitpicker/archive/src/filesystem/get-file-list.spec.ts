import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getFileList } from './get-file-list.js';

describe('getFileList', () => {
	const testDir = path.join(tmpdir(), 'nitpicker-test-get-file-list');

	beforeEach(() => {
		mkdirSync(testDir, { recursive: true });
		writeFileSync(path.join(testDir, 'a.txt'), '');
		writeFileSync(path.join(testDir, 'b.json'), '');
		writeFileSync(path.join(testDir, 'c.txt'), '');
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('lists all files without filter', async () => {
		const list = await getFileList(testDir);
		expect(list.toSorted()).toEqual(['a.txt', 'b.json', 'c.txt']);
	});

	it('filters by regex', async () => {
		const list = await getFileList(testDir, /\.txt$/);
		expect(list.toSorted()).toEqual(['a.txt', 'c.txt']);
	});

	it('filters by string', async () => {
		const list = await getFileList(testDir, '.json');
		expect(list).toEqual(['b.json']);
	});
});
