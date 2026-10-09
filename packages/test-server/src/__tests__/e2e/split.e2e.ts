import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Archive from '@nitpicker/archive/archive';
import { isViewerReadModelCurrent } from '@nitpicker/query';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SERVER_PORT } from './test-server-port.js';

/** Absolute path to the built CLI entry point. */
const CLI_BIN = path.resolve(
	import.meta.dirname,
	'../../../../@nitpicker/cli/bin/nitpicker.js',
);

/**
 * Spawns the real, built `nitpicker` CLI binary. See `concat.e2e.ts`'s copy
 * of this same helper for why each e2e file keeps its own.
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

describe('split', () => {
	// Reuses the existing `/scope/blog|docs|admin/` fixture (see
	// `concat.e2e.ts`'s same note). A single multi-root crawl from both
	// `/scope/blog/` and `/scope/admin/` produces one archive covering all
	// three sections (blog links to docs, so docs is reachable too) —
	// exactly the shape split needs: narrowing back down to `/scope/blog/`
	// must keep blog in full, stub the referenced-but-out-of-scope docs
	// top page, and drop both docs/api (unreferenced once docs is a stub)
	// and the entirely-unrelated admin section.
	let cwd: string;
	let combinedArchivePath: string;

	beforeAll(async () => {
		cwd = path.join(os.tmpdir(), `nitpicker-e2e-split-${crypto.randomUUID()}`);
		await fs.mkdir(cwd, { recursive: true });

		const crawl = await runCli(
			[
				'crawl',
				`http://localhost:${TEST_SERVER_PORT}/scope/blog/`,
				`http://localhost:${TEST_SERVER_PORT}/scope/admin/`,
				'-o',
				'combined',
				'--silent',
				'--no-image',
				'--no-fetch-external',
			],
			cwd,
		);
		expect(crawl.exitCode).toBe(0);
		combinedArchivePath = path.join(cwd, 'combined.nitpicker');
	}, 90_000);

	afterAll(async () => {
		await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
	});

	it('keeps in-scope pages, stubs a referenced out-of-scope page, drops the rest', async () => {
		const result = await runCli(
			[
				'split',
				combinedArchivePath,
				`http://localhost:${TEST_SERVER_PORT}/scope/blog/`,
				'-o',
				'blog-only',
			],
			cwd,
		);
		expect(result.exitCode).toBe(0);

		const outputPath = path.join(cwd, 'blog-only.nitpicker');
		const archive = await Archive.open({ filePath: outputPath, cwd });
		try {
			const config = await archive.getConfig();
			expect(config.roots).toEqual([`http://localhost:${TEST_SERVER_PORT}/scope/blog/`]);

			const knex = archive.getKnex();
			const rows: { url: string; isExternal: number }[] = await knex
				.select('url_refs.url as url', 'content_items.is_external as isExternal')
				.from('content_items')
				.join('url_refs', 'url_refs.id', 'content_items.url_id');
			const byPath = new Map(rows.map((r) => [new URL(r.url).pathname, r.isExternal]));

			expect(byPath.get('/scope/blog/')).toBe(0);
			expect(byPath.get('/scope/blog/post-1')).toBe(0);
			expect(byPath.get('/scope/blog/post-2')).toBe(0);
			expect(byPath.get('/scope/docs/')).toBe(1); // referenced stub
			expect(byPath.has('/scope/docs/api')).toBe(false); // dropped
			expect(byPath.has('/scope/admin/')).toBe(false); // dropped
			expect(byPath.has('/scope/admin/settings')).toBe(false); // dropped

			// The stub carries no page-scoped data.
			const docsPageId = rows.find((r) => new URL(r.url).pathname === '/scope/docs/');
			expect(docsPageId).toBeDefined();
			const docsMeta = await knex
				.select('page_meta.title_text_id')
				.from('page_meta')
				.join('content_items', 'content_items.id', 'page_meta.page_id')
				.join('url_refs', 'url_refs.id', 'content_items.url_id')
				.where('url_refs.url', 'like', '%/scope/docs/');
			expect(docsMeta).toHaveLength(0);

			expect(await isViewerReadModelCurrent(archive)).toBe(true);

			// Templates are re-derived from the extracted pages: the three
			// in-scope pages are classified, the external stub is not.
			const templatedRows: { url: string }[] = await knex
				.select('url_refs.url as url')
				.from('page_templates')
				.join('content_items', 'content_items.id', 'page_templates.page_id')
				.join('url_refs', 'url_refs.id', 'content_items.url_id');
			expect(templatedRows.map((r) => new URL(r.url).pathname).toSorted()).toEqual([
				'/scope/blog/',
				'/scope/blog/post-1',
				'/scope/blog/post-2',
			]);

			const { pending } = await archive.getCrawlingState();
			expect(pending).toEqual([]);
		} finally {
			await archive.close();
		}

		const summary = await runCli(['query', outputPath, 'summary'], cwd);
		expect(summary.exitCode).toBe(0);
	}, 60_000);

	it('rejects a scope URL outside the source archive entirely', async () => {
		const result = await runCli(
			['split', combinedArchivePath, 'http://localhost:1/nonexistent/', '-o', 'nope'],
			cwd,
		);
		expect(result.exitCode).toBe(1);
	});

	it('requires -o/--output', async () => {
		const result = await runCli(
			['split', combinedArchivePath, `http://localhost:${TEST_SERVER_PORT}/scope/blog/`],
			cwd,
		);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('-o/--output');
	});

	it('cleans up after a mid-pipeline failure (a corrupted source), leaving no output file or stray tmpDir behind', async () => {
		// See `concat.e2e.ts`'s identical case for why this specific
		// shape (passes path/extension validation, fails once
		// `Archive.openCached` actually tries to extract it) is the
		// realistic scenario `cleanupFailedTransfer` exists for.
		const corruptPath = path.join(cwd, 'corrupt.nitpicker');
		await fs.writeFile(corruptPath, 'not a tar archive');

		const result = await runCli(
			[
				'split',
				corruptPath,
				`http://localhost:${TEST_SERVER_PORT}/scope/blog/`,
				'-o',
				'from-corrupt',
			],
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
