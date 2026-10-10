import type { ChildProcess } from 'node:child_process';

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

/** Upper bound for one CLI run; a page takes several seconds to scrape. */
const PROCESS_EXIT_TIMEOUT = 120_000;

/**
 * Upper bound for the first hashed page to appear. Shorter than
 * {@link PROCESS_EXIT_TIMEOUT} so a stub that never gets a hash fails with
 * the poller's own diagnostic rather than the generic exit timeout.
 */
const FIRST_HASH_TIMEOUT = 90_000;

/** Outcome of a spawned CLI run. */
interface ExitResult {
	code: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
}

/** A started CLI process. */
interface SpawnedCli {
	child: ChildProcess;
	/** Settles once the process exits (rejects after {@link PROCESS_EXIT_TIMEOUT}). */
	exited: Promise<ExitResult>;
}

/** Every CLI this suite started, so `afterAll` can kill any still running. */
const spawnedChildren: ChildProcess[] = [];

/**
 * Starts the built CLI.
 * @param params - What to run.
 * @param params.args - CLI arguments (after the binary path).
 * @param params.cwd - Working directory for the spawned process.
 * @returns The child process and a promise for how it exits.
 */
function spawnCli(params: { args: string[]; cwd: string }): SpawnedCli {
	const child = spawn(process.execPath, [CLI_BIN, ...params.args], {
		cwd: params.cwd,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	spawnedChildren.push(child);
	let stdout = '';
	let stderr = '';
	child.stdout?.on('data', (chunk: Buffer) => {
		stdout += chunk.toString();
	});
	child.stderr?.on('data', (chunk: Buffer) => {
		stderr += chunk.toString();
	});
	const exited = new Promise<ExitResult>((resolve, reject) => {
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
	return { child, exited };
}

/**
 * Resolves with the crawl's working directory once at least one page has a
 * `body_hash` — i.e. once the crawling process has called into the native
 * addon. Reads the live stub through a read-only connection.
 *
 * Errors while the stub is still being created (no `db.sqlite` schema yet, a
 * busy database) are expected and polled through; the last one is attached
 * as the cause if the deadline passes, so a real failure stays visible.
 * @param params - What to watch.
 * @param params.cwd - Directory the crawl was started in.
 * @param params.child - The crawling process; polling fails as soon as it exits.
 * @returns Absolute path of the stub directory.
 */
async function waitForFirstBodyHash(params: {
	cwd: string;
	child: ChildProcess;
}): Promise<string> {
	const deadline = Date.now() + FIRST_HASH_TIMEOUT;
	let lastError: unknown = null;
	while (Date.now() < deadline) {
		if (params.child.exitCode !== null || params.child.signalCode !== null) {
			throw new Error('the crawl exited before any page got a body_hash', {
				cause: lastError,
			});
		}
		try {
			const stubDir = await findStubWithBodyHash(params.cwd);
			if (stubDir) {
				return stubDir;
			}
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(
		`no page in ${params.cwd} got a body_hash within ${FIRST_HASH_TIMEOUT}ms`,
		{ cause: lastError },
	);
}

/**
 * One poll of {@link waitForFirstBodyHash}.
 * @param cwd - Directory the crawl was started in.
 * @returns The stub directory once it holds a hashed page, otherwise `null`.
 */
async function findStubWithBodyHash(cwd: string): Promise<string | null> {
	const entries = await fs.readdir(cwd);
	const stub = entries.find(
		(name) => name.startsWith(Archive.TMP_DIR_PREFIX) && !name.endsWith('.lock'),
	);
	if (!stub || !existsSync(path.join(cwd, stub, 'db.sqlite'))) {
		return null;
	}
	const stubDir = path.join(cwd, stub);
	const accessor = await Archive.connect(stubDir);
	try {
		const [row] = (await accessor
			.getKnex()('page_meta')
			.whereNotNull('body_hash')
			.count({ count: '*' })) as { count: number }[];
		return Number(row?.count ?? 0) > 0 ? stubDir : null;
	} finally {
		await accessor.close();
	}
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
		// A failed assertion can leave a crawl running; stop it before removing
		// the directory it writes into.
		for (const child of spawnedChildren) {
			child.kill('SIGKILL');
		}
		await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
	});

	it('runs the interrupt action, keeps the stub, and the stub resumes to a finished archive', async () => {
		// `/pagination/page/9` → `/page/10` is a two-page chain: the signal goes
		// out after the first page is hashed, with the second still to come.
		const crawl = spawnCli({
			args: [
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
		});
		const stubDir = await waitForFirstBodyHash({ cwd, child: crawl.child });
		expect(crawl.child.kill('SIGINT')).toBe(true);
		const interrupted = await crawl.exited;

		// Exiting on its own (signal === null) rather than by the signal proves
		// the CLI's handler ran instead of the default SIGINT disposition.
		expect(interrupted.signal).toBeNull();
		expect(interrupted.code).toBe(0);
		expect(existsSync(path.join(stubDir, 'db.sqlite'))).toBe(true);
		const filesAfterInterrupt = await fs.readdir(cwd);
		expect(filesAfterInterrupt.filter((name) => name.endsWith('.nitpicker'))).toEqual([]);

		// The interrupted process's lock must not block a resume.
		const resumed = await spawnCli({
			args: ['crawl', '--resume', stubDir, '--silent'],
			cwd,
		}).exited;
		expect(resumed.code, resumed.stderr).toBe(0);
		const filesAfterResume = await fs.readdir(cwd);
		expect(filesAfterResume.filter((name) => name.endsWith('.nitpicker'))).toHaveLength(
			1,
		);
	}, 300_000);
});
