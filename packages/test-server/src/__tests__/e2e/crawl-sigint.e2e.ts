import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Archive from '@nitpicker/archive/archive';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SERVER_PORT } from './test-server-port.js';

/** Absolute path to the built CLI entry point. */
const CLI_BIN = path.resolve(
	import.meta.dirname,
	'../../../../@nitpicker/cli/bin/nitpicker.js',
);

/** Prefix of the crawl's working directory (`Archive.TMP_DIR_PREFIX`). */
const STUB_PREFIX = '._nitpicker-';

/** Upper bound for one CLI run; a page takes several seconds to scrape. */
const PROCESS_EXIT_TIMEOUT = 120_000;

/** Outcome of a spawned CLI run. */
interface ExitResult {
	code: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
}

/**
 * Spawns the built CLI and resolves once it exits.
 * @param args - CLI arguments (after the binary path).
 * @param cwd - Working directory for the spawned process.
 * @param onSpawn - Called with the child process right after it starts, so a
 *   test can signal it while it is still crawling.
 * @returns How the process exited, with its captured output.
 */
function runCli(
	args: string[],
	cwd: string,
	onSpawn?: (child: ReturnType<typeof spawn>) => void,
): Promise<ExitResult> {
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
	onSpawn?.(child);
	return new Promise<ExitResult>((resolve, reject) => {
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			reject(
				new Error(
					`CLI did not exit within ${PROCESS_EXIT_TIMEOUT}ms\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
				),
			);
		}, PROCESS_EXIT_TIMEOUT);
		child.once('exit', (code, signal) => {
			clearTimeout(timer);
			resolve({ code, signal, stdout, stderr });
		});
		child.once('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});
}

/**
 * Resolves with the crawl's working directory once at least one page has a
 * `body_hash` — i.e. once the crawling process has called into the native
 * addon. Reads the live stub through a read-only connection.
 * @param cwd - Directory the crawl was started in.
 * @returns Absolute path of the stub directory.
 */
async function waitForFirstBodyHash(cwd: string): Promise<string> {
	const deadline = Date.now() + PROCESS_EXIT_TIMEOUT;
	while (Date.now() < deadline) {
		const entries = await fs.readdir(cwd);
		const stub = entries.find(
			(name) => name.startsWith(STUB_PREFIX) && !name.endsWith('.lock'),
		);
		if (stub && existsSync(path.join(cwd, stub, 'db.sqlite'))) {
			const stubDir = path.join(cwd, stub);
			const accessor = await Archive.connect(stubDir);
			try {
				const [row] = (await accessor
					.getKnex()('page_meta')
					.whereNotNull('body_hash')
					.count({ count: '*' })) as { count: number }[];
				if (Number(row?.count ?? 0) > 0) {
					return stubDir;
				}
			} catch {
				// The schema may not be created yet; poll again.
			} finally {
				await accessor.close();
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(`no page in ${cwd} got a body_hash within ${PROCESS_EXIT_TIMEOUT}ms`);
}

/**
 * Ctrl-C during a crawl must still run the CLI's own interrupt action
 * (`createCrawlInterruptAction`: abort, kill Chromium, exit) and leave a
 * resumable stub. Covered end to end because the crawl process loads the
 * `@nitpicker/core` native addon; a native module that installed its own
 * signal handling or held the event loop would let the default SIGINT
 * disposition win (exit by signal, no cleanup) instead.
 */
describe('crawl interrupted by SIGINT (e2e)', () => {
	let cwd: string;

	beforeAll(async () => {
		cwd = path.join(os.tmpdir(), `nitpicker-e2e-sigint-${crypto.randomUUID()}`);
		await fs.mkdir(cwd, { recursive: true });
	});

	afterAll(async () => {
		await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
	});

	it('runs the interrupt action, keeps the stub, and the stub resumes to a finished archive', async () => {
		let stubDir = '';
		let signalSent = false;
		// `/pagination/page/9` → `/page/10` is a two-page chain: the signal goes
		// out after the first page is hashed, with the second still to come.
		const interrupted = await runCli(
			[
				'crawl',
				`http://localhost:${TEST_SERVER_PORT}/pagination/page/9`,
				'--silent',
				'--no-image',
				'--no-fetch-external',
				'--parallels',
				'1',
				'--interval',
				'3000',
			],
			cwd,
			(child) => {
				void waitForFirstBodyHash(cwd).then((dir) => {
					stubDir = dir;
					signalSent = child.kill('SIGINT');
				});
			},
		);

		expect(signalSent).toBe(true);
		// Exiting on its own (signal === null) rather than by the signal proves
		// the CLI's handler ran instead of the default SIGINT disposition.
		expect(interrupted.signal).toBeNull();
		expect(interrupted.code).toBe(0);
		expect(existsSync(path.join(stubDir, 'db.sqlite'))).toBe(true);
		const filesAfterInterrupt = await fs.readdir(cwd);
		expect(filesAfterInterrupt.filter((name) => name.endsWith('.nitpicker'))).toEqual([]);

		// The interrupted process's lock must not block a resume.
		const resumed = await runCli(['crawl', '--resume', stubDir, '--silent'], cwd);
		expect(resumed.code, resumed.stderr).toBe(0);
		const filesAfterResume = await fs.readdir(cwd);
		expect(filesAfterResume.filter((name) => name.endsWith('.nitpicker'))).toHaveLength(
			1,
		);
	}, 300_000);
});
