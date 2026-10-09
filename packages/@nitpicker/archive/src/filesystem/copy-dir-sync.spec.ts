import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { copyDirSync } from './copy-dir-sync.js';

describe('copyDirSync', () => {
	const testDir = path.join(tmpdir(), 'nitpicker-test-copy-dir-sync');
	const srcDir = path.join(testDir, 'src');
	const destDir = path.join(testDir, 'dest');

	beforeEach(() => {
		mkdirSync(srcDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('synchronously copies directory contents', () => {
		writeFileSync(path.join(srcDir, 'a.txt'), 'sync');
		copyDirSync(srcDir, destDir);
		expect(readFileSync(path.join(destDir, 'a.txt'), 'utf8')).toBe('sync');
	});
});
