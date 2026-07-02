import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { hasViewerReadModel } from '@nitpicker/query';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Absolute path to the built CLI entry point. */
const CLI_BIN = path.resolve(
	import.meta.dirname,
	'../../../../@nitpicker/cli/bin/nitpicker.js',
);

/**
 * Spawns the real, built `nitpicker` CLI binary with the given args and
 * resolves with its exit code once it terminates on its own.
 * @param args - CLI arguments (after the binary path).
 * @param cwd - Working directory for the spawned process.
 * @returns The process's exit code (or `null` if it was killed by a signal).
 */
async function runCli(args: string[], cwd: string): Promise<number | null> {
	const child = spawn(process.execPath, [CLI_BIN, ...args], {
		cwd,
		stdio: ['ignore', 'pipe', 'pipe'],
	});

	let stdoutBuf = '';
	let stderrBuf = '';
	child.stdout?.on('data', (chunk: Buffer) => {
		stdoutBuf += chunk.toString();
	});
	child.stderr?.on('data', (chunk: Buffer) => {
		stderrBuf += chunk.toString();
	});

	const PROCESS_EXIT_TIMEOUT = 60_000;
	return new Promise<number | null>((resolve, reject) => {
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			reject(
				new Error(
					`CLI did not exit within ${PROCESS_EXIT_TIMEOUT}ms\n--- stdout ---\n${stdoutBuf}\n--- stderr ---\n${stderrBuf}`,
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
}

describe('viewer read model — build timing (issue #112)', () => {
	// Both `it()`s below exercise the REAL CLI wiring end to end —
	// `crawl.spec.ts`, `ensure-viewer-read-model-quietly.spec.ts`, and
	// `viewer-build.spec.ts` all mock away `ensureViewerReadModelQuietly` /
	// `ensureViewerReadModel` / `buildViewerReadModel` entirely, so none of
	// them prove the CLI hooks actually produce a working read model in a
	// real `.nitpicker` file. Spawning the built `bin/nitpicker.js` (not
	// `CrawlerOrchestrator` directly, which every other e2e test in this
	// suite uses and which never runs the CLI-layer hook) is the only path
	// that does. A single shared crawl keeps this fast: the second test
	// forces a rebuild against the archive the first test already produced,
	// rather than paying for a second full crawl.
	let cwd: string;
	let archivePath: string;

	beforeAll(async () => {
		cwd = path.join(os.tmpdir(), `nitpicker-e2e-read-model-${crypto.randomUUID()}`);
		await fs.mkdir(cwd, { recursive: true });

		const exitCode = await runCli(
			[
				'crawl',
				'http://localhost:8010/',
				'--silent',
				'--no-image',
				'--no-fetch-external',
				'--no-recursive',
			],
			cwd,
		);
		expect(exitCode).toBe(0);

		const entries = await fs.readdir(cwd);
		const archiveName = entries.find((name) => name.endsWith('.nitpicker'));
		expect(archiveName).toBeDefined();
		archivePath = path.join(cwd, archiveName!);
	}, 90_000);

	afterAll(async () => {
		await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
	});

	it('crawl 完了後、生成された .nitpicker に永続 viewer read model が自動構築される', async () => {
		const archive = await Archive.open({ filePath: archivePath, cwd });
		try {
			expect(await hasViewerReadModel(archive)).toBe(true);
		} finally {
			await archive.close();
		}
	});

	it('nitpicker viewer-build --force で既存アーカイブの read model を明示的に再構築できる', async () => {
		const exitCode = await runCli(['viewer-build', archivePath, '--force'], cwd);
		expect(exitCode).toBe(0);

		const archive = await Archive.open({ filePath: archivePath, cwd });
		try {
			expect(await hasViewerReadModel(archive)).toBe(true);
		} finally {
			await archive.close();
		}
	}, 30_000);
});
