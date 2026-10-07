import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SERVER_PORT } from './test-server-port.js';

/** Absolute path to the built CLI entry point. */
const CLI_BIN = path.resolve(
	import.meta.dirname,
	'../../../../@nitpicker/cli/bin/nitpicker.js',
);

const API_KEY = 'e2e-api-key';
const BEARER_TOKEN = 'cli-e2e-bearer-token';
const ENTRY_URL = `http://localhost:${TEST_SERVER_PORT}/request-headers/`;
const APPEND_URL = `http://localhost:${TEST_SERVER_PORT}/request-headers/inscope-page`;

interface CliRun {
	readonly code: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

/**
 * Runs the built CLI to completion.
 * @param args - CLI arguments after `nitpicker.js`.
 * @param cwd - Working directory of the process.
 * @returns Exit code and the captured stdout / stderr.
 */
function runCli(args: string[], cwd: string): Promise<CliRun> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [CLI_BIN, ...args], {
			cwd,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		child.stdout?.on('data', (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			reject(
				new Error(
					`CLI did not exit in time\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
				),
			);
		}, 90_000);
		child.once('exit', (code) => {
			clearTimeout(timer);
			resolve({ code, stdout, stderr });
		});
		child.once('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});
}

describe('CLI request headers (E2E)', () => {
	let cwd: string;
	let archive: string;
	let headerFile: string;

	beforeAll(async () => {
		cwd = path.join(os.tmpdir(), `nitpicker-e2e-cli-headers-${crypto.randomUUID()}`);
		await fs.mkdir(cwd, { recursive: true });
		archive = path.join(cwd, 'site.nitpicker');
		headerFile = path.join(cwd, 'headers.txt');
		await fs.writeFile(
			headerFile,
			`# e2e\nX-Api-Key: ${API_KEY}\nAuthorization: Bearer ${BEARER_TOKEN}\n`,
		);
	});

	afterAll(async () => {
		await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
	});

	it('crawls a protected site with --header-file, and neither the output nor the archive carries the values', async () => {
		const run = await runCli(
			[
				'crawl',
				ENTRY_URL,
				'--header-file',
				headerFile,
				'--output',
				archive,
				'--verbose',
				'--no-image',
				'--no-fetch-external',
				'--no-recursive',
			],
			cwd,
		);

		expect(run.code, `stderr:\n${run.stderr}`).toBe(0);
		// `--verbose` turns on every debug logger; the values must not appear.
		for (const secret of [API_KEY, BEARER_TOKEN]) {
			expect(run.stdout).not.toContain(secret);
			expect(run.stderr).not.toContain(secret);
		}

		const bytes = await fs.readFile(archive);
		expect(bytes.includes(API_KEY)).toBe(false);
		expect(bytes.includes(BEARER_TOKEN)).toBe(false);
	}, 120_000);

	it('--append without the headers warns that they were recorded but not supplied', async () => {
		const run = await runCli(
			['crawl', archive, '--append', APPEND_URL, '--silent', '--no-image'],
			cwd,
		);

		expect(run.code, `stderr:\n${run.stderr}`).not.toBeNull();
		expect(run.stderr).toContain('request header(s) X-Api-Key, Authorization');
	}, 120_000);

	it('--append --verbose with the headers does not warn and does not log the values', async () => {
		const run = await runCli(
			[
				'crawl',
				archive,
				'--append',
				APPEND_URL,
				'--header-file',
				headerFile,
				'--verbose',
				'--no-image',
			],
			cwd,
		);

		expect(run.code, `stderr:\n${run.stderr}`).toBe(0);
		expect(run.stderr).not.toContain('request header(s)');
		// The archive-update debug log used to print the raw patch, values included.
		for (const secret of [API_KEY, BEARER_TOKEN]) {
			expect(run.stdout).not.toContain(secret);
			expect(run.stderr).not.toContain(secret);
		}
	}, 120_000);

	it('rejects a malformed --header before launching anything', async () => {
		const run = await runCli(
			['crawl', ENTRY_URL, '--header', 'no-colon-here', '--silent'],
			cwd,
		);

		expect(run.code).not.toBe(0);
		expect(run.stderr).toContain('expected "Name: value"');
	}, 60_000);
});
