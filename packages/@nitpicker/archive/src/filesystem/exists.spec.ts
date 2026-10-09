import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { exists } from './exists.js';

describe('exists', () => {
	const testDir = path.join(tmpdir(), 'nitpicker-test-exists');

	beforeEach(() => {
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('returns true for an existing file', () => {
		const filePath = path.join(testDir, 'file.txt');
		writeFileSync(filePath, 'test');
		expect(exists(filePath)).toBe(true);
	});

	it('returns false for a non-existing file', () => {
		expect(exists(path.join(testDir, 'nonexistent.txt'))).toBe(false);
	});

	it('returns true for an existing directory', () => {
		expect(exists(testDir)).toBe(true);
	});
});
