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

/** Result of a completed `runCli` invocation. */
interface CliResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

/**
 * Spawns the real, built `nitpicker` CLI binary with the given args and
 * resolves once it exits on its own, capturing its output.
 * @param args - CLI arguments (after the binary path).
 * @param cwd - Working directory for the spawned process.
 * @param env - Extra environment variables to merge over `process.env`.
 * @returns The process's exit code and captured stdout/stderr.
 */
async function runCli(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv = {},
): Promise<CliResult> {
	const child = spawn(process.execPath, [CLI_BIN, ...args], {
		cwd,
		env: { ...process.env, ...env },
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

	const PROCESS_EXIT_TIMEOUT = 60_000;
	return new Promise<CliResult>((resolve, reject) => {
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			reject(
				new Error(
					`CLI did not exit within ${PROCESS_EXIT_TIMEOUT}ms\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
				),
			);
		}, PROCESS_EXIT_TIMEOUT);

		child.once('exit', (code) => {
			clearTimeout(timer);
			resolve({ exitCode: code, stdout, stderr });
		});
		child.once('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});
}

describe('nitpicker cache CLI (on-disk cache list/clear)', () => {
	// `cache.spec.ts` mocks `@nitpicker/crawler` entirely to unit-test the
	// command's own branching, so it proves nothing about whether the real
	// `getArchiveCacheRoot`/`listArchiveCacheEntries`/`clearArchiveCache*`
	// functions actually agree with what `Archive.openCached` writes to disk.
	// Spawning the built CLI (same pattern as `viewer-read-model-build.e2e.ts`)
	// is the only way to prove that end-to-end wiring.
	//
	// `NITPICKER_TAR_CACHE_DIR` pins every cache read/write below to a
	// throwaway directory — required so this suite never touches a real
	// developer machine's `os.tmpdir()/nitpicker/cache/`.
	let cwd: string;
	let cacheRoot: string;
	let archivePath: string;

	beforeAll(async () => {
		cwd = path.join(os.tmpdir(), `nitpicker-e2e-cache-cwd-${crypto.randomUUID()}`);
		cacheRoot = path.join(os.tmpdir(), `nitpicker-e2e-cache-root-${crypto.randomUUID()}`);
		await fs.mkdir(cwd, { recursive: true });

		const crawlResult = await runCli(
			[
				'crawl',
				`http://localhost:${TEST_SERVER_PORT}/`,
				'--silent',
				'--no-image',
				'--no-fetch-external',
				'--no-recursive',
			],
			cwd,
		);
		expect(crawlResult.exitCode).toBe(0);

		const entries = await fs.readdir(cwd);
		const archiveName = entries.find((name) => name.endsWith('.nitpicker'));
		expect(archiveName).toBeDefined();
		archivePath = path.join(cwd, archiveName!);
	}, 90_000);

	afterAll(async () => {
		await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
		await fs.rm(cacheRoot, { recursive: true, force: true }).catch(() => {});
	});

	it('a read-only query open populates a tar-cache entry that `cache list --json` reports', async () => {
		const queryResult = await runCli(['query', archivePath, 'summary'], cwd, {
			NITPICKER_TAR_CACHE_DIR: cacheRoot,
		});
		expect(queryResult.exitCode).toBe(0);

		const listResult = await runCli(['cache', 'list', '--json'], cwd, {
			NITPICKER_TAR_CACHE_DIR: cacheRoot,
		});
		expect(listResult.exitCode).toBe(0);
		const entries = JSON.parse(listResult.stdout) as Array<{
			kind: string;
			sizeBytes: number;
		}>;
		expect(
			entries.some((entry) => entry.kind === 'tar-cache' && entry.sizeBytes > 0),
		).toBe(true);
	}, 60_000);

	it("`cache clear <archive>` removes only that archive's entry", async () => {
		const clearResult = await runCli(['cache', 'clear', archivePath], cwd, {
			NITPICKER_TAR_CACHE_DIR: cacheRoot,
		});
		expect(clearResult.exitCode).toBe(0);
		expect(clearResult.stdout).toContain('Removed cache entry');

		const listResult = await runCli(['cache', 'list', '--json'], cwd, {
			NITPICKER_TAR_CACHE_DIR: cacheRoot,
		});
		const entries = JSON.parse(listResult.stdout) as Array<{ kind: string }>;
		expect(entries.some((entry) => entry.kind === 'tar-cache')).toBe(false);
	}, 30_000);

	it('`cache clear` with no archive argument empties the entire cache root', async () => {
		// Re-populate the tar-cache entry the previous test removed.
		const repopulate = await runCli(['query', archivePath, 'summary'], cwd, {
			NITPICKER_TAR_CACHE_DIR: cacheRoot,
		});
		expect(repopulate.exitCode).toBe(0);

		const clearResult = await runCli(['cache', 'clear'], cwd, {
			NITPICKER_TAR_CACHE_DIR: cacheRoot,
		});
		expect(clearResult.exitCode).toBe(0);
		expect(clearResult.stdout).toContain('Removed cache root');

		const listResult = await runCli(['cache', 'list', '--json'], cwd, {
			NITPICKER_TAR_CACHE_DIR: cacheRoot,
		});
		expect(JSON.parse(listResult.stdout)).toEqual([]);
	}, 60_000);
});
