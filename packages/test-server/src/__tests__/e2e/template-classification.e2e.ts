import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
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

/**
 * Crawls the test server's root page into a fresh directory and returns the
 * produced archive's path.
 * @param cwd - Directory to crawl into.
 * @param extraArgs - Additional `crawl` flags.
 */
async function crawlInto(cwd: string, extraArgs: string[]): Promise<string> {
	await fs.mkdir(cwd, { recursive: true });
	const exitCode = await runCli(
		[
			'crawl',
			`http://localhost:${TEST_SERVER_PORT}/`,
			'--silent',
			'--no-image',
			'--no-fetch-external',
			'--no-recursive',
			...extraArgs,
		],
		cwd,
	);
	expect(exitCode).toBe(0);

	const entries = await fs.readdir(cwd);
	const archiveName = entries.find((name) => name.endsWith('.nitpicker'));
	expect(archiveName).toBeDefined();
	return path.join(cwd, archiveName!);
}

/**
 * Reads the template tables' row counts and label rows from an archive.
 * @param archivePath - The `.nitpicker` file.
 * @param cwd - Working directory for `Archive.open`.
 */
async function readTemplateTables(archivePath: string, cwd: string) {
	const archive = await Archive.open({ filePath: archivePath, cwd });
	try {
		const knex = archive.getKnex();
		const pageTemplates = await knex('page_templates').count({ n: '*' }).first();
		const clusters = await knex('page_template_clusters').count({ n: '*' }).first();
		const labels = await knex('page_template_labels')
			.select('template_key', 'section', 'ordinal')
			.orderBy('template_key');
		return {
			pageTemplateCount: Number(pageTemplates?.n ?? 0),
			clusterCount: Number(clusters?.n ?? 0),
			labels,
		};
	} finally {
		await archive.close();
	}
}

describe('page template classification at crawl end', () => {
	// Spawns the real built CLI (not `CrawlerOrchestrator`): the crawl-end
	// classification row lives in the CLI layer (`run-post-crawl-task-list.ts`),
	// which every orchestrator-level e2e test bypasses.
	let root: string;

	beforeAll(async () => {
		root = path.join(os.tmpdir(), `nitpicker-e2e-templates-${crypto.randomUUID()}`);
		await fs.mkdir(root, { recursive: true });
	});

	afterAll(async () => {
		await fs.rm(root, { recursive: true, force: true }).catch(() => {});
	});

	it('crawl 完了時に既定でページが分類され、ラベルも保存される', async () => {
		const cwd = path.join(root, 'default');
		const archivePath = await crawlInto(cwd, []);

		const tables = await readTemplateTables(archivePath, cwd);
		expect(tables.pageTemplateCount).toBeGreaterThan(0);
		expect(tables.clusterCount).toBeGreaterThan(0);
		expect(tables.labels.length).toBeGreaterThan(0);
	}, 90_000);

	it('--skip-templates で作ったアーカイブは未分類で、viewer-build で分類され、再実行してもラベルが変わらない', async () => {
		const cwd = path.join(root, 'skipped');
		const archivePath = await crawlInto(cwd, ['--skip-templates']);

		const before = await readTemplateTables(archivePath, cwd);
		expect(before.pageTemplateCount).toBe(0);
		expect(before.labels).toEqual([]);

		expect(await runCli(['viewer-build', archivePath], cwd)).toBe(0);
		const classified = await readTemplateTables(archivePath, cwd);
		expect(classified.pageTemplateCount).toBeGreaterThan(0);
		expect(classified.labels.length).toBeGreaterThan(0);

		expect(await runCli(['viewer-build', archivePath], cwd)).toBe(0);
		const rerun = await readTemplateTables(archivePath, cwd);
		expect(rerun.labels).toEqual(classified.labels);
	}, 120_000);

	it('viewer-build --skip-templates は既存の分類に触れない', async () => {
		const cwd = path.join(root, 'keep');
		const archivePath = await crawlInto(cwd, []);
		const before = await readTemplateTables(archivePath, cwd);

		expect(await runCli(['viewer-build', archivePath, '--skip-templates'], cwd)).toBe(0);

		expect(await readTemplateTables(archivePath, cwd)).toEqual(before);
	}, 120_000);
});
