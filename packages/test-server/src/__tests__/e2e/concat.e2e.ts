import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { isViewerReadModelCurrent } from '@nitpicker/query';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SERVER_PORT } from './test-server-port.js';

/** Absolute path to the built CLI entry point. */
const CLI_BIN = path.resolve(
	import.meta.dirname,
	'../../../../@nitpicker/cli/bin/nitpicker.js',
);

/**
 * Spawns the real, built `nitpicker` CLI binary with the given args and
 * resolves with its exit code and captured output once it terminates on
 * its own. Mirrors `viewer-read-model-build.e2e.ts`'s `runCli` (each e2e
 * file keeps its own copy — the existing, accepted pattern in this suite).
 * @param args - CLI arguments (after the binary path).
 * @param cwd - Working directory for the spawned process.
 */
async function runCli(
	args: string[],
	cwd: string,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
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
	return new Promise((resolve, reject) => {
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
			resolve({ exitCode: code, stdout: stdoutBuf, stderr: stderrBuf });
		});
		child.once('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});
}

describe('concat', () => {
	// Reuses the existing `/scope/blog|admin/` fixture
	// (`packages/test-server/src/routes/scope.ts`) rather than adding a new
	// one: `/scope/blog/` and `/scope/admin/` are disjoint sections with no
	// shared URLs, which is enough to prove the CLI wiring end to end for
	// a merge (SQL-level merge correctness, including same-URL conflict
	// resolution, is covered by `@nitpicker/crawler`'s own unit/integration
	// specs — `transfer-archive-rows.spec.ts` in particular).
	let cwd: string;
	let archiveAPath: string;
	let archiveBPath: string;

	beforeAll(async () => {
		cwd = path.join(os.tmpdir(), `nitpicker-e2e-concat-${crypto.randomUUID()}`);
		await fs.mkdir(cwd, { recursive: true });

		const a = await runCli(
			[
				'crawl',
				`http://localhost:${TEST_SERVER_PORT}/scope/blog/`,
				'-o',
				'a',
				'--silent',
				'--no-image',
				'--no-fetch-external',
			],
			cwd,
		);
		expect(a.exitCode).toBe(0);
		archiveAPath = path.join(cwd, 'a.nitpicker');

		const b = await runCli(
			[
				'crawl',
				`http://localhost:${TEST_SERVER_PORT}/scope/admin/`,
				'-o',
				'b',
				'--silent',
				'--no-image',
				'--no-fetch-external',
			],
			cwd,
		);
		expect(b.exitCode).toBe(0);
		archiveBPath = path.join(cwd, 'b.nitpicker');
	}, 90_000);

	afterAll(async () => {
		await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
	});

	it('merges two disjoint archives into one with a unioned scope', async () => {
		const result = await runCli(
			['concat', archiveAPath, archiveBPath, '-o', 'merged'],
			cwd,
		);
		expect(result.exitCode).toBe(0);

		const mergedPath = path.join(cwd, 'merged.nitpicker');
		const archive = await Archive.open({ filePath: mergedPath, cwd });
		try {
			const config = await archive.getConfig();
			expect(config.roots).toEqual([
				`http://localhost:${TEST_SERVER_PORT}/scope/blog/`,
				`http://localhost:${TEST_SERVER_PORT}/scope/admin/`,
			]);

			const knex = archive.getKnex();
			const rows: { url: string; isExternal: number }[] = await knex
				.select('url_refs.url as url', 'content_items.is_external as isExternal')
				.from('content_items')
				.join('url_refs', 'url_refs.id', 'content_items.url_id')
				.where('content_items.scraped', 1);
			const byPath = new Map(rows.map((r) => [new URL(r.url).pathname, r.isExternal]));

			// `/scope/blog/`'s own scope is (hostname, port, `/scope/blog/`) —
			// a sibling directory like `/scope/docs/` falls outside it, and
			// `--no-fetch-external` means the crawler never even records an
			// anchor to it (no HEAD check, no content_items row at all) —
			// so the merged archive is exactly each source's own internal
			// pages, unioned with nothing left over to reconcile.
			expect(byPath.get('/scope/admin/')).toBe(0);
			expect(byPath.get('/scope/admin/settings')).toBe(0);
			expect(byPath.get('/scope/blog/')).toBe(0);
			expect(byPath.get('/scope/blog/post-1')).toBe(0);
			expect(byPath.get('/scope/blog/post-2')).toBe(0);
			expect(rows).toHaveLength(5);

			expect(await isViewerReadModelCurrent(archive)).toBe(true);

			const { pending } = await archive.getCrawlingState();
			expect(pending).toEqual([]);
		} finally {
			await archive.close();
		}

		const summary = await runCli(['query', mergedPath, 'summary'], cwd);
		expect(summary.exitCode).toBe(0);
		expect(() => JSON.parse(summary.stdout)).not.toThrow();
	}, 60_000);

	it('refuses to overwrite an existing output path', async () => {
		const outputPath = path.join(cwd, 'preexisting.nitpicker');
		await fs.writeFile(outputPath, '');
		const result = await runCli(
			['concat', archiveAPath, archiveBPath, '-o', 'preexisting'],
			cwd,
		);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('already exists');
		await fs.rm(outputPath, { force: true });
	});

	it('rejects a single input archive', async () => {
		const result = await runCli(['concat', archiveAPath, '-o', 'single'], cwd);
		expect(result.exitCode).toBe(1);
	});

	it('requires -o/--output', async () => {
		const result = await runCli(['concat', archiveAPath, archiveBPath], cwd);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('-o/--output');
	});

	it('cleans up after a mid-pipeline failure (a corrupted second source), leaving no output file or stray tmpDir behind', async () => {
		// Passes the up-front path/extension validation (exists, is a file,
		// `.nitpicker` extension) but is not a real tar archive, so
		// `Archive.openCached` fails once its own "Extract archive 2/2" row
		// actually runs — after the destination has already been created
		// (`Archive.create` runs in an EARLIER row) and the first source has
		// already been opened. This is the realistic "failed partway
		// through, not at validation time" scenario `cleanupFailedTransfer`
		// exists for.
		const corruptPath = path.join(cwd, 'corrupt.nitpicker');
		await fs.writeFile(corruptPath, 'not a tar archive');

		const result = await runCli(
			['concat', archiveAPath, corruptPath, '-o', 'from-corrupt'],
			cwd,
		);
		expect(result.exitCode).toBe(1);

		const outputPath = path.join(cwd, 'from-corrupt.nitpicker');
		await expect(fs.access(outputPath)).rejects.toThrow();
		await expect(fs.access(path.join(cwd, '._nitpicker-from-corrupt'))).rejects.toThrow();
		await expect(fs.access(path.join(cwd, 'from-corrupt'))).rejects.toThrow();

		await fs.rm(corruptPath, { force: true });
	}, 30_000);
});
