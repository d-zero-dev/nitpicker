import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Absolute path to the built CLI entry point. */
const CLI_BIN = path.resolve(
	import.meta.dirname,
	'../../../../@nitpicker/cli/bin/nitpicker.js',
);

/**
 * Small, committed, real-crawl `.nitpicker` fixture (2 pages, viewer read
 * model pre-built) — `query` never re-fetches anything, so unlike every
 * other e2e test in this suite this one needs no live test-server request at
 * all, only a completed archive. See `report.e2e.ts`'s docs for how it was
 * produced.
 */
const FIXTURE = path.resolve(
	import.meta.dirname,
	'fixtures/report-query-fixture.nitpicker',
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

describe('query search-html / pages-by-resource / resource-hosts / links (e2e)', () => {
	// The unit specs cover each query function against a real `Archive`; this
	// proves the built CLI binary wires the new sub-commands and flags
	// end to end (stdout stays pure JSON — progress goes to stderr).
	let cwd: string;

	beforeAll(async () => {
		cwd = path.join(os.tmpdir(), `nitpicker-e2e-query-search-${crypto.randomUUID()}`);
		await fs.mkdir(cwd, { recursive: true });
	});

	afterAll(async () => {
		await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
	});

	it('search-html scans stored HTML without analyze and reports scan totals', async () => {
		const { exitCode, stdout } = await runCli(
			['query', FIXTURE, 'search-html', '--pattern', '/<html/i', '--limit', '0'],
			cwd,
		);

		expect(exitCode).toBe(0);
		const output = JSON.parse(stdout) as {
			items: unknown[];
			total: number;
			scannedSnapshots: number;
			candidatePages: number;
		};
		expect(output.items).toEqual([]);
		expect(output.candidatePages).toBeGreaterThan(0);
		expect(output.scannedSnapshots).toBeGreaterThan(0);
		expect(output.total).toBeGreaterThan(0);
	});

	it('search-html returns snippets for matching pages', async () => {
		const { exitCode, stdout } = await runCli(
			['query', FIXTURE, 'search-html', '--pattern', '<html', '--limit', '1'],
			cwd,
		);

		expect(exitCode).toBe(0);
		const output = JSON.parse(stdout) as {
			items: { url: string; matchCount: number; snippet: string }[];
		};
		expect(output.items).toHaveLength(1);
		expect(output.items[0]!.snippet).toContain('<html');
		expect(output.items[0]!.matchCount).toBeGreaterThan(0);
	});

	it('search-html rejects an invalid regular expression with exit code 1', async () => {
		const { exitCode, stdout } = await runCli(
			['query', FIXTURE, 'search-html', '--pattern', '/(/'],
			cwd,
		);

		expect(exitCode).toBe(1);
		expect(stdout).toBe('');
	});

	it('pages-by-resource requires a resource filter', async () => {
		const { exitCode } = await runCli(['query', FIXTURE, 'pages-by-resource'], cwd);

		expect(exitCode).toBe(1);
	});

	it('resource-hosts and links (type omitted) return JSON', async () => {
		const hosts = await runCli(['query', FIXTURE, 'resource-hosts'], cwd);
		expect(hosts.exitCode).toBe(0);
		expect(JSON.parse(hosts.stdout)).toHaveProperty('items');

		const links = await runCli(['query', FIXTURE, 'links', '--limit', '1'], cwd);
		expect(links.exitCode).toBe(0);
		expect(JSON.parse(links.stdout)).toHaveProperty('total');
	});
});

describe('query match-urls (e2e)', () => {
	// `match-url-list.spec.ts` and `dispatch-query.spec.ts` already cover
	// every branch of this diagnostic subcommand against a real `Archive`
	// fixture / mocked dispatch. This is the one test that proves the real,
	// built `bin/nitpicker.js` CLI binary — flag parsing, `readUrlListFile`,
	// and the `matchUrlList` wiring — actually produces the documented JSON
	// shape end to end (see `viewer-read-model-build.e2e.ts`'s docs for why
	// spawning the built binary is the only path that proves this).
	let cwd: string;

	beforeAll(async () => {
		cwd = path.join(os.tmpdir(), `nitpicker-e2e-query-${crypto.randomUUID()}`);
		await fs.mkdir(cwd, { recursive: true });
	});

	afterAll(async () => {
		await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
	});

	it('reports found/notFound counts and per-URL details as JSON on stdout', async () => {
		const urlsFile = path.join(cwd, 'urls.txt');
		await fs.writeFile(
			urlsFile,
			'http://localhost:49375\nhttp://localhost:49375/nonexistent\n',
			'utf8',
		);

		const { exitCode, stdout } = await runCli(
			['query', FIXTURE, 'match-urls', '--urls', urlsFile],
			cwd,
		);

		expect(exitCode).toBe(0);
		const output = JSON.parse(stdout) as {
			results: { url: string; found: boolean }[];
			invalidLines: unknown[];
			summary: { total: number; invalid: number; found: number; notFound: number };
		};
		expect(output.summary).toEqual({ total: 2, invalid: 0, found: 1, notFound: 1 });
		expect(output.invalidLines).toEqual([]);
		expect(output.results.find((r) => r.url === 'http://localhost:49375')?.found).toBe(
			true,
		);
		expect(
			output.results.find((r) => r.url === 'http://localhost:49375/nonexistent')?.found,
		).toBe(false);
	});
});
