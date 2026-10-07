import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveRequestHeaders } from './resolve-request-headers.js';

let dir: string;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nitpicker-resolve-headers-'));
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

describe('resolveRequestHeaders', () => {
	it('returns undefined when no header flag is given', async () => {
		expect(await resolveRequestHeaders({})).toBeUndefined();
		expect(await resolveRequestHeaders({ header: [] })).toBeUndefined();
	});

	it('merges --header-file, --header and --authorization', async () => {
		const file = path.join(dir, 'h.txt');
		await fs.writeFile(file, 'X-From-File: f\n');
		expect(
			await resolveRequestHeaders({
				headerFile: file,
				header: ['X-Api-Key: k'],
				authorization: 'Bearer t',
			}),
		).toEqual({ 'X-From-File': 'f', 'X-Api-Key': 'k', Authorization: 'Bearer t' });
	});

	it('maps --authorization to the Authorization header', async () => {
		expect(await resolveRequestHeaders({ authorization: 'Basic abc' })).toEqual({
			Authorization: 'Basic abc',
		});
	});

	it('rejects a name given twice (case-insensitive) and names both sources', async () => {
		await expect(
			resolveRequestHeaders({
				header: ['authorization: Bearer a'],
				authorization: 'Bearer b',
			}),
		).rejects.toThrow('specified more than once (--header and --authorization)');
	});

	it('does not leak values in the duplicate error', async () => {
		const error = await resolveRequestHeaders({
			header: ['X-A: secret-one', 'X-A: secret-two'],
		}).catch((error_: unknown) => error_ as Error);
		expect((error as Error).message).not.toContain('secret-');
	});

	it('rejects an empty --authorization value', async () => {
		await expect(resolveRequestHeaders({ authorization: '' })).rejects.toThrow(
			'must not be empty',
		);
	});

	it('propagates a malformed --header', async () => {
		await expect(resolveRequestHeaders({ header: ['no-colon-here'] })).rejects.toThrow(
			'expected "Name: value"',
		);
	});
});
