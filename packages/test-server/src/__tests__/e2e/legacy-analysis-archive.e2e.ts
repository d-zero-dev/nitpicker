import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Archive from '@nitpicker/archive/archive';
import { CrawlerOrchestrator } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { injectLegacyAnalysisTables } from './inject-legacy-analysis-tables.js';
import { TEST_SERVER_ORIGIN } from './test-server-port.js';

/**
 * Archives written by earlier versions carry `analysis_text_refs` /
 * `analysis_violations` (FK → `content_items(id)`), tables the current schema
 * no longer creates. These tests build such an archive at test time and check
 * that every writer / reader path still completes: re-crawling pages cleans up
 * their legacy rows, `concat` does not carry the tables over, and the
 * read-only commands exit cleanly.
 */

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
 * resolves once it exits on its own, capturing its output. Mirrors
 * `concat.e2e.ts`'s `runCli` (each e2e file keeps its own copy).
 * @param args - CLI arguments (after the binary path).
 * @param cwd - Working directory for the spawned process.
 * @returns The process's exit code and captured stdout/stderr.
 */
async function runCli(args: string[], cwd: string): Promise<CliResult> {
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

	const PROCESS_EXIT_TIMEOUT = 90_000;
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

/**
 * Crawls `urls` into a `.nitpicker` file, then rewrites it into the
 * earlier-version shape with {@link injectLegacyAnalysisTables}.
 * @param cwd - Working directory the archive is written under.
 * @param urls - One or more URLs to crawl.
 * @returns The archive path and the number of violation rows seeded.
 */
async function buildLegacyArchive(
	cwd: string,
	urls: string[],
): Promise<{ filePath: string; seeded: number }> {
	const orchestrator = await CrawlerOrchestrator.crawling(urls, {
		cwd,
		interval: 0,
		parallels: 1,
		image: false,
		fetchExternal: false,
	});
	const filePath = orchestrator.archive.filePath;
	await orchestrator.write();
	await orchestrator.archive.close();
	orchestrator.garbageCollect();

	const seeded = await injectLegacyAnalysisTables(filePath, cwd);
	return { filePath, seeded };
}

/**
 * Lists the pathnames of the pages that still have an `analysis_violations`
 * row in the archive.
 * @param filePath - Absolute path to the `.nitpicker` archive.
 * @param cwd - Working directory used for the temporary extraction.
 * @returns Sorted pathnames, one per violation row.
 */
async function listViolationPaths(filePath: string, cwd: string): Promise<string[]> {
	const archive = await Archive.open({ filePath, cwd });
	try {
		const rows: { url: string }[] = await archive
			.getKnex()
			.select('url_refs.url as url')
			.from('analysis_violations')
			.join('content_items', 'content_items.id', 'analysis_violations.page_id')
			.join('url_refs', 'url_refs.id', 'content_items.url_id');
		return rows.map((row) => new URL(row.url).pathname).toSorted();
	} finally {
		await archive.close();
	}
}

/**
 * Lists the `analysis_*` tables present in the archive.
 * @param filePath - Absolute path to the `.nitpicker` archive.
 * @param cwd - Working directory used for the temporary extraction.
 * @returns Sorted table names starting with `analysis_`.
 */
async function listAnalysisTables(filePath: string, cwd: string): Promise<string[]> {
	const archive = await Archive.open({ filePath, cwd });
	try {
		const rows: { name: string }[] = await archive
			.getKnex()
			.select('name')
			.from('sqlite_master')
			.where('type', 'table')
			.whereRaw("name LIKE 'analysis\\_%' ESCAPE '\\'");
		return rows.map((row) => row.name).toSorted();
	} finally {
		await archive.close();
	}
}

/**
 * Toggle the `/flaky/recoverable` route between failing (500) and healed (200).
 * @param state - `'heal'` to serve 200, `'reset'` to serve 500.
 */
async function setFlakyState(state: 'heal' | 'reset'): Promise<void> {
	const res = await fetch(`${TEST_SERVER_ORIGIN}/flaky/control/${state}`);
	await res.text();
	if (!res.ok) {
		throw new Error(`flaky control "${state}" failed with HTTP ${res.status}`);
	}
}

describe('legacy analysis archive: recrawl', () => {
	let cwd: string;
	let filePath: string;
	let seeded: number;

	beforeAll(async () => {
		cwd = path.join(os.tmpdir(), `nitpicker-e2e-legacy-recrawl-${crypto.randomUUID()}`);
		await fs.mkdir(cwd, { recursive: true });
		({ filePath, seeded } = await buildLegacyArchive(cwd, [`${TEST_SERVER_ORIGIN}/`]));
	}, 240_000);

	afterAll(async () => {
		await fs.rm(cwd, { recursive: true, force: true });
	});

	it('deletes the legacy violation rows of a re-crawled page', async () => {
		expect(seeded).toBeGreaterThanOrEqual(2);
		const before = await listViolationPaths(filePath, cwd);
		expect(before).toContain('/');
		expect(before).toContain('/about');

		const orchestrator = await CrawlerOrchestrator.recrawl(
			filePath,
			[`${TEST_SERVER_ORIGIN}/`],
			{ cwd },
		);
		await orchestrator.write();
		await orchestrator.archive.close();
		orchestrator.garbageCollect();

		const after = await listViolationPaths(filePath, cwd);
		expect(after).not.toContain('/');
		expect(after).toContain('/about');
	}, 240_000);
});

describe('legacy analysis archive: retry-failed', () => {
	let cwd: string;
	let filePath: string;

	beforeAll(async () => {
		cwd = path.join(os.tmpdir(), `nitpicker-e2e-legacy-retry-${crypto.randomUUID()}`);
		await fs.mkdir(cwd, { recursive: true });
		await setFlakyState('reset');
		({ filePath } = await buildLegacyArchive(cwd, [`${TEST_SERVER_ORIGIN}/flaky/`]));
	}, 240_000);

	afterAll(async () => {
		await fs.rm(cwd, { recursive: true, force: true });
		await setFlakyState('reset');
	});

	it('leaves the legacy rows untouched when a failed page is retried', async () => {
		const before = await listViolationPaths(filePath, cwd);
		expect(before).toContain('/flaky/');
		expect(before).toContain('/flaky/recoverable');

		await setFlakyState('heal');
		const orchestrator = await CrawlerOrchestrator.retryFailed(filePath, { cwd });
		await orchestrator.write();
		await orchestrator.archive.close();
		orchestrator.garbageCollect();

		const recovered = await Archive.open({ filePath, cwd });
		try {
			const pages = await recovered.getPages('page');
			const recoverable = pages.find((p) => p.url.pathname === '/flaky/recoverable');
			expect(recoverable).toBeDefined();
			expect(recoverable!.status).toBe(200);
		} finally {
			await recovered.close();
		}

		const after = await listViolationPaths(filePath, cwd);
		// Retrying a failed page does not touch its legacy violation rows.
		expect(after).toContain('/flaky/recoverable');
		expect(after).toContain('/flaky/');
	}, 240_000);
});

describe('legacy analysis archive: concat and read-only commands', () => {
	let cwd: string;
	let blogPath: string;
	let adminPath: string;

	beforeAll(async () => {
		cwd = path.join(os.tmpdir(), `nitpicker-e2e-legacy-concat-${crypto.randomUUID()}`);
		await fs.mkdir(cwd, { recursive: true });
		const blogDir = path.join(cwd, 'blog');
		const adminDir = path.join(cwd, 'admin');
		await fs.mkdir(blogDir, { recursive: true });
		await fs.mkdir(adminDir, { recursive: true });
		({ filePath: blogPath } = await buildLegacyArchive(blogDir, [
			`${TEST_SERVER_ORIGIN}/scope/blog/`,
		]));
		({ filePath: adminPath } = await buildLegacyArchive(adminDir, [
			`${TEST_SERVER_ORIGIN}/scope/admin/`,
		]));
	}, 240_000);

	afterAll(async () => {
		await fs.rm(cwd, { recursive: true, force: true });
	});

	it('the seeded fixture really carries the legacy tables', async () => {
		expect(await listAnalysisTables(blogPath, cwd)).toEqual([
			'analysis_text_refs',
			'analysis_violations',
		]);
	}, 60_000);

	it('concat completes and the output has no analysis_* tables', async () => {
		const result = await runCli(['concat', blogPath, adminPath, '-o', 'merged'], cwd);
		expect(result.exitCode, result.stderr).toBe(0);

		const mergedPath = path.join(cwd, 'merged.nitpicker');
		expect(await listAnalysisTables(mergedPath, cwd)).toEqual([]);
	}, 240_000);

	it('viewer-build completes on the legacy archive', async () => {
		const result = await runCli(['viewer-build', blogPath, '--force'], cwd);
		expect(result.exitCode, result.stderr).toBe(0);
	}, 120_000);

	it('query summary completes on the legacy archive', async () => {
		const result = await runCli(['query', blogPath, 'summary'], cwd);
		expect(result.exitCode, result.stderr).toBe(0);
		expect(() => JSON.parse(result.stdout)).not.toThrow();
	}, 120_000);

	it('report -H completes on the legacy archive', async () => {
		const outputPath = path.join(cwd, 'legacy-report.html');
		const result = await runCli(['report', blogPath, '-H', '-o', outputPath], cwd);
		expect(result.exitCode, result.stderr).toBe(0);
		await expect(fs.stat(outputPath)).resolves.toBeDefined();
	}, 120_000);
});
