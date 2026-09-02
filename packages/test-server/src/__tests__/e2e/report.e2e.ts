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
 * model pre-built) — `report`/`query` never re-fetch anything, so unlike
 * every other e2e test in this suite this one needs no live test-server
 * request at all, only a completed archive. See the fixtures directory's
 * README for how it was produced and how to regenerate it.
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

describe('report -H --urls (e2e)', () => {
	// Unit/integration specs (`report-html/src/report.spec.ts`,
	// `resolve-page-selection.spec.ts`) already cover every branch of this
	// feature against a real `Archive` fixture built via the low-level
	// `Archive.create()` API. This is the one test in the whole suite that
	// proves the real, built `bin/nitpicker.js` CLI binary — flag parsing,
	// `readUrlListFile`, and the report-html package wiring — actually
	// produces a working file end to end (see
	// `viewer-read-model-build.e2e.ts`'s docs for why spawning the built
	// binary is the only path that proves this).
	let cwd: string;

	beforeAll(async () => {
		cwd = path.join(os.tmpdir(), `nitpicker-e2e-report-${crypto.randomUUID()}`);
		await fs.mkdir(cwd, { recursive: true });
	});

	afterAll(async () => {
		await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
	});

	it('restricts the HTML report to matched --urls entries and warns about the unmatched one', async () => {
		const urlsFile = path.join(cwd, 'urls.txt');
		await fs.writeFile(
			urlsFile,
			'http://localhost:49375\nhttp://localhost:49375/nonexistent\n',
			'utf8',
		);
		const outputPath = path.join(cwd, 'out.html');

		const { exitCode, stdout, stderr } = await runCli(
			['report', FIXTURE, '-H', '-o', outputPath, '--urls', urlsFile],
			cwd,
		);

		expect(exitCode).toBe(0);
		expect(stdout).toContain(`Wrote ${outputPath}`);
		expect(stderr).toContain('1 of 2 URL(s) were not found in the report');

		const html = await fs.readFile(outputPath, 'utf8');
		expect(html).toContain('localhost:49375');
		expect(html).not.toContain('/about');
	});
});
