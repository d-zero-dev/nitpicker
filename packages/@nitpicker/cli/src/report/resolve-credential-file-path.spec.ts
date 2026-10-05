import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveCredentialFilePath } from './resolve-credential-file-path.js';

describe('resolveCredentialFilePath', () => {
	let cwd: string;
	const originalEnv = process.env.GOOGLE_AUTH_CREDENTIALS;

	beforeEach(async () => {
		cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nitpicker-credentials-'));
		delete process.env.GOOGLE_AUTH_CREDENTIALS;
	});

	afterEach(async () => {
		await fs.rm(cwd, { recursive: true, force: true });
		if (originalEnv === undefined) {
			delete process.env.GOOGLE_AUTH_CREDENTIALS;
		} else {
			process.env.GOOGLE_AUTH_CREDENTIALS = originalEnv;
		}
	});

	it('returns the explicit path even when env and credentials.json exist', async () => {
		await fs.writeFile(path.join(cwd, 'credentials.json'), '{}');
		expect(
			resolveCredentialFilePath('./explicit.json', {
				cwd,
				env: { GOOGLE_AUTH_CREDENTIALS: '/env/path.json' },
			}),
		).toBe('./explicit.json');
	});

	it('returns the env path as is, even when the file does not exist', () => {
		expect(
			resolveCredentialFilePath(undefined, {
				cwd,
				env: { GOOGLE_AUTH_CREDENTIALS: '/env/missing.json' },
			}),
		).toBe('/env/missing.json');
	});

	it('prefers the env path over an existing credentials.json', async () => {
		await fs.writeFile(path.join(cwd, 'credentials.json'), '{}');
		expect(
			resolveCredentialFilePath(undefined, {
				cwd,
				env: { GOOGLE_AUTH_CREDENTIALS: '/env/path.json' },
			}),
		).toBe('/env/path.json');
	});

	it('returns the absolute path of credentials.json in cwd when env is unset', async () => {
		await fs.writeFile(path.join(cwd, 'credentials.json'), '{}');
		expect(resolveCredentialFilePath(undefined, { cwd, env: {} })).toBe(
			path.join(cwd, 'credentials.json'),
		);
	});

	it('returns undefined when nothing is available', () => {
		expect(resolveCredentialFilePath(undefined, { cwd, env: {} })).toBeUndefined();
	});

	it('treats an empty explicit path as unset and falls through to the env path', () => {
		expect(
			resolveCredentialFilePath('', {
				cwd,
				env: { GOOGLE_AUTH_CREDENTIALS: '/env/path.json' },
			}),
		).toBe('/env/path.json');
	});

	it('treats an empty env value as unset and falls through to credentials.json', async () => {
		await fs.writeFile(path.join(cwd, 'credentials.json'), '{}');
		expect(
			resolveCredentialFilePath(undefined, {
				cwd,
				env: { GOOGLE_AUTH_CREDENTIALS: '' },
			}),
		).toBe(path.join(cwd, 'credentials.json'));
	});

	it('reads process.env when options are omitted', () => {
		process.env.GOOGLE_AUTH_CREDENTIALS = '/from/process/env.json';
		expect(resolveCredentialFilePath()).toBe('/from/process/env.json');
	});
});
