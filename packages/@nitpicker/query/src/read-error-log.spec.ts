import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readErrorLog } from './read-error-log.js';

let workDir = '';

beforeEach(async () => {
	workDir = await mkdtemp(path.join(tmpdir(), 'nitpicker-read-error-log-'));
});

afterEach(async () => {
	await rm(workDir, { recursive: true, force: true });
});

describe('readErrorLog', () => {
	it('returns an empty array when error.log is missing', async () => {
		const records = await readErrorLog(workDir);
		expect(records).toEqual([]);
	});

	it('parses entries shaped like `[pid(main)] <url> <message>`', async () => {
		await writeFile(
			path.join(workDir, 'error.log'),
			[
				'[1234(main)] https://example.com/a Error: connect ECONNREFUSED',
				'[1234(sub)] https://example.com/b Navigation timeout of 60000 ms',
				'',
			].join('\n'),
			'utf8',
		);

		const records = await readErrorLog(workDir);
		expect(records).toHaveLength(2);
		expect(records[0]).toEqual({
			url: 'https://example.com/a',
			message: 'Error: connect ECONNREFUSED',
			createdAt: null,
		});
		expect(records[1]).toEqual({
			url: 'https://example.com/b',
			message: 'Navigation timeout of 60000 ms',
			createdAt: null,
		});
	});

	it('treats explicit `null` and empty URL tokens as `null`', async () => {
		await writeFile(
			path.join(workDir, 'error.log'),
			'[42(main)] null process-level boom\n',
			'utf8',
		);
		const records = await readErrorLog(workDir);
		expect(records).toHaveLength(1);
		expect(records[0]!.url).toBeNull();
		expect(records[0]!.message).toBe('process-level boom');
	});

	it('skips lines that do not match the `[pid(main|sub)]` header', async () => {
		await writeFile(
			path.join(workDir, 'error.log'),
			[
				'   at Object.fn (file.js:1:1)',
				'[7(main)] https://example.com/c getaddrinfo ENOTFOUND foo.invalid',
				'continuation-line without header',
			].join('\n'),
			'utf8',
		);
		const records = await readErrorLog(workDir);
		expect(records).toHaveLength(1);
		expect(records[0]!.url).toBe('https://example.com/c');
	});
});
