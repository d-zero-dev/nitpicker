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

	it('scans stored HTML and reports scan totals', async () => {
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

describe('query match-selector (e2e)', () => {
	// The unit specs cover the selector engine and `matchSelector` against real
	// archives; this proves the built CLI binary wires the flag, the progress
	// line (stderr) and the pure-JSON stdout end to end. The fixture's two
	// pages are `/` (an <a>, an <img> and a lazy <img> directly under <body>)
	// and `/about` (an <a> directly under <body>).
	let cwd: string;

	beforeAll(async () => {
		cwd = path.join(os.tmpdir(), `nitpicker-e2e-query-selector-${crypto.randomUUID()}`);
		await fs.mkdir(cwd, { recursive: true });
	});

	afterAll(async () => {
		await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
	});

	/**
	 * Runs `match-selector` against the fixture and returns its parsed JSON result.
	 * @param selector - The selector.
	 */
	async function matchSelector(selector: string): Promise<{
		items: { url: string }[];
		prefilteredSnapshots: number;
		tokenizedSnapshots: number;
	}> {
		const { exitCode, stdout } = await runCli(
			['query', FIXTURE, 'match-selector', '--selector', selector],
			cwd,
		);
		expect(exitCode).toBe(0);
		return JSON.parse(stdout);
	}

	it('finds the page with a single-compound selector, decided without the open-element stack', async () => {
		const result = await matchSelector('img[loading="lazy"]');

		expect(result.items.map((item) => item.url)).toEqual(['http://localhost:49375']);
		// `/about` has no `lazy`, so it is rejected on literals; the other is decided by the scan
		expect(result).toMatchObject({ prefilteredSnapshots: 1, tokenizedSnapshots: 0 });
	});

	it('finds pages by a child combinator, decided on the open-element stack', async () => {
		const result = await matchSelector('body > a');
		expect(result.items.map((item) => item.url)).toEqual([
			'http://localhost:49375',
			'http://localhost:49375/about',
		]);
		expect(result.tokenizedSnapshots).toBe(2);

		const deeper = await matchSelector('html[lang="en"] > head > title');
		expect(deeper.items.map((item) => item.url)).toEqual([
			'http://localhost:49375',
			'http://localhost:49375/about',
		]);
	});

	it('skips snapshots that lack a literal the selector needs', async () => {
		// `/about` has no <img>, so only the top page is read by the stack
		const result = await matchSelector('body > img');

		expect(result.items.map((item) => item.url)).toEqual(['http://localhost:49375']);
		expect(result).toMatchObject({ prefilteredSnapshots: 1, tokenizedSnapshots: 1 });
	});

	it('matches a selector list and sibling-position selectors', async () => {
		const list = await matchSelector('a, img:first-of-type');
		expect(list.items.map((item) => item.url)).toEqual([
			'http://localhost:49375',
			'http://localhost:49375/about',
		]);

		const position = await matchSelector('img:nth-of-type(2)');
		expect(position.items.map((item) => item.url)).toEqual(['http://localhost:49375']);
	});

	it('matches an attribute value stored with escaped < and >', async () => {
		const result = await matchSelector('img[src*="<rect"]');

		expect(result.items.map((item) => item.url)).toEqual(['http://localhost:49375']);
	});

	it('returns no pages when nothing matches, and says how the answer was reached', async () => {
		const { exitCode, stdout } = await runCli(
			['query', FIXTURE, 'match-selector', '--selector', 'article'],
			cwd,
		);

		expect(exitCode).toBe(0);
		expect(JSON.parse(stdout)).toMatchObject({
			selector: 'article',
			items: [],
			total: 0,
			scannedSnapshots: 2,
			candidatePages: 2,
			tokenizedSnapshots: 0,
		});
	});

	it('slices the result with --limit and --offset', async () => {
		const { exitCode, stdout } = await runCli(
			[
				'query',
				FIXTURE,
				'match-selector',
				'--selector',
				'a',
				'--limit',
				'1',
				'--offset',
				'1',
			],
			cwd,
		);

		expect(exitCode).toBe(0);
		const output = JSON.parse(stdout) as { items: { url: string }[]; total: number };
		expect(output.items.map((item) => item.url)).toEqual([
			'http://localhost:49375/about',
		]);
		expect(output.total).toBe(2);
	});

	it('narrows the scanned pages with --url-pattern and --directory', async () => {
		const byUrl = await runCli(
			['query', FIXTURE, 'match-selector', '--selector', 'a', '--url-pattern', '%/about'],
			cwd,
		);
		expect(byUrl.exitCode).toBe(0);
		expect(JSON.parse(byUrl.stdout)).toMatchObject({
			items: [{ url: 'http://localhost:49375/about' }],
			total: 1,
			scannedSnapshots: 1,
			candidatePages: 1,
		});

		// The directory page itself is in its directory
		const byDirectory = await runCli(
			['query', FIXTURE, 'match-selector', '--selector', 'a', '--directory', '/about'],
			cwd,
		);
		expect(byDirectory.exitCode).toBe(0);
		expect(JSON.parse(byDirectory.stdout)).toMatchObject({
			items: [{ url: 'http://localhost:49375/about' }],
			total: 1,
			scannedSnapshots: 1,
			candidatePages: 1,
		});

		// No fixture page lives in /blog, so nothing is scanned at all
		const elsewhere = await runCli(
			['query', FIXTURE, 'match-selector', '--selector', 'a', '--directory', '/blog'],
			cwd,
		);
		expect(elsewhere.exitCode).toBe(0);
		expect(JSON.parse(elsewhere.stdout)).toMatchObject({
			items: [],
			total: 0,
			scannedSnapshots: 0,
			candidatePages: 0,
		});
	});

	it('rejects a blank --directory with exit code 1 before opening the archive', async () => {
		const { exitCode, stdout, stderr } = await runCli(
			['query', FIXTURE, 'match-selector', '--selector', 'a', '--directory', ' '],
			cwd,
		);

		expect(exitCode).toBe(1);
		expect(stdout).toBe('');
		expect(stderr).toContain('Invalid --directory value');
		expect(stderr).not.toContain('Extracting archive');
	});

	it.each([
		['div[', 'syntax error'],
		['', 'the selector is empty'],
	])('rejects the selector %j before opening the archive', async (selector, reason) => {
		const { exitCode, stdout, stderr } = await runCli(
			['query', FIXTURE, 'match-selector', '--selector', selector],
			cwd,
		);

		expect(exitCode).toBe(1);
		expect(stdout).toBe('');
		expect(stderr).toContain(reason);
		expect(stderr).not.toContain('Extracting archive');
	});

	it('keeps stdout pure JSON while progress goes to stderr', async () => {
		const { exitCode, stdout, stderr } = await runCli(
			['query', FIXTURE, 'match-selector', '--selector', 'a', '--limit', '0'],
			cwd,
		);

		expect(exitCode).toBe(0);
		expect(() => JSON.parse(stdout)).not.toThrow();
		expect(stderr).toContain('Scanning HTML snapshots');
		expect(stdout).not.toContain('Scanning HTML snapshots');
	});

	it('rejects a selector that needs later markup with exit code 1 and the supported grammar', async () => {
		const { exitCode, stdout, stderr } = await runCli(
			['query', FIXTURE, 'match-selector', '--selector', 'a + b'],
			cwd,
		);

		expect(exitCode).toBe(1);
		expect(stdout).toBe('');
		expect(stderr).toContain('adjacent sibling combinator');
		expect(stderr).toContain('Supported selectors');
	});

	it('requires --selector', async () => {
		const { exitCode, stdout, stderr } = await runCli(
			['query', FIXTURE, 'match-selector'],
			cwd,
		);

		expect(exitCode).toBe(1);
		expect(stdout).toBe('');
		expect(stderr).toContain('--selector is required');
	});
});
