import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { TEST_SERVER_PORT } from './test-server-port.js';

/** Absolute path to the built CLI entry point. */
const CLI_BIN = path.resolve(
	import.meta.dirname,
	'../../../../@nitpicker/cli/bin/nitpicker.js',
);

describe('CLI process termination', () => {
	it('crawl 完了後に CLI プロセスが自然終了する', async () => {
		const cwd = path.join(os.tmpdir(), `nitpicker-e2e-cli-exit-${crypto.randomUUID()}`);
		await fs.mkdir(cwd, { recursive: true });

		try {
			const child = spawn(
				process.execPath,
				[
					CLI_BIN,
					'crawl',
					`http://localhost:${TEST_SERVER_PORT}/`,
					'--silent',
					'--no-image',
					'--no-fetch-external',
					'--no-recursive',
				],
				{ cwd, stdio: ['ignore', 'pipe', 'pipe'] },
			);

			let stdoutBuf = '';
			let stderrBuf = '';
			child.stdout?.on('data', (chunk: Buffer) => {
				stdoutBuf += chunk.toString();
			});
			child.stderr?.on('data', (chunk: Buffer) => {
				stderrBuf += chunk.toString();
			});

			const PROCESS_EXIT_TIMEOUT = 60_000;
			const exitCode = await new Promise<number | null>((resolve, reject) => {
				const timer = setTimeout(() => {
					child.kill('SIGKILL');
					reject(
						new Error(
							`CLI did not exit within ${PROCESS_EXIT_TIMEOUT}ms — archive DB pool likely leaked\n--- stdout ---\n${stdoutBuf}\n--- stderr ---\n${stderrBuf}`,
						),
					);
				}, PROCESS_EXIT_TIMEOUT);

				child.once('exit', (code) => {
					clearTimeout(timer);
					resolve(code);
				});
				child.once('error', (error) => {
					clearTimeout(timer);
					reject(error);
				});
			});

			if (exitCode !== 0) {
				// eslint-disable-next-line no-console
				console.error('--- stdout ---\n', stdoutBuf, '\n--- stderr ---\n', stderrBuf);
			}
			expect(exitCode).toBe(0);

			const entries = await fs.readdir(cwd);
			const archives = entries.filter((name) => name.endsWith('.nitpicker'));
			expect(archives.length).toBe(1);
		} finally {
			await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
		}
	}, 90_000);
});
