import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Archive, CrawlerOrchestrator } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Run a baseline crawl that creates a `.nitpicker` archive on disk, then close
 * it so the caller can re-open it via `Archive.open`. Returns the archive file
 * path and the cwd where the temp dir lives.
 * @param urls - One or more URLs to crawl.
 * @param options - Optional crawl configuration overrides.
 * @returns Paths to the produced archive and its cwd.
 */
async function crawlAndPersist(
	urls: string[],
	options: Record<string, unknown> = {},
): Promise<{ filePath: string; cwd: string }> {
	const cwd = path.join(os.tmpdir(), `nitpicker-append-${crypto.randomUUID()}`);
	await fs.mkdir(cwd, { recursive: true });

	const orchestrator = await CrawlerOrchestrator.crawling(urls, {
		cwd,
		interval: 0,
		parallels: 1,
		image: false,
		...options,
	});
	const filePath = orchestrator.archive.filePath;
	await orchestrator.write();
	await orchestrator.archive.close();
	orchestrator.garbageCollect();

	return { filePath, cwd };
}

describe('Append crawl', () => {
	let filePath: string;
	let cwd: string;
	let accessor: Archive;

	beforeAll(async () => {
		// 1) Baseline archive scoped to /scope/blog/. /scope/docs/ is reached via
		//    a link and therefore recorded as external metadata-only.
		const baseline = await crawlAndPersist(['http://localhost:8010/scope/blog/'], {
			fetchExternal: true,
		});
		filePath = baseline.filePath;
		cwd = baseline.cwd;

		// 2) Append /scope/docs/ as a new root. The expanded scope demotes the
		//    previously-external /scope/docs/ and re-crawls it as internal.
		const orchestrator = await CrawlerOrchestrator.append(
			filePath,
			['http://localhost:8010/scope/docs/'],
			{ cwd, fetchExternal: true },
		);
		await orchestrator.write();
		await orchestrator.archive.close();
		orchestrator.garbageCollect();

		// Re-open for reading.
		accessor = await Archive.open({ filePath, cwd });
	}, 240_000);

	afterAll(async () => {
		await accessor?.close();
		await fs.rm(cwd, { recursive: true, force: true });
	});

	it('appended root is recorded as a fully-internal page (not metadata-only)', async () => {
		const internalPages = await accessor.getPages('internal-page');
		const docsPage = internalPages.find((p) => p.url.pathname === '/scope/docs/');
		expect(docsPage).toBeDefined();
		expect(docsPage!.isExternal).toBe(false);
		expect(docsPage!.isTarget).toBe(true);
	});

	it('child pages under the appended root are crawled', async () => {
		const internalPages = await accessor.getPages('internal-page');
		const paths = internalPages.map((p) => p.url.pathname);
		expect(paths).toContain('/scope/docs/api');
	});

	it('info.roots records both the original and the appended root', async () => {
		const config = await accessor.getConfig();
		expect(config.roots).toEqual([
			'http://localhost:8010/scope/blog/',
			'http://localhost:8010/scope/docs/',
		]);
	});

	it('info.scope merges the new root into the existing scope set', async () => {
		const config = await accessor.getConfig();
		expect(config.scope).toEqual(
			expect.arrayContaining([
				'http://localhost:8010/scope/blog/',
				'http://localhost:8010/scope/docs/',
			]),
		);
	});

	it('removes the .bak backup file once the append succeeds', async () => {
		const exists = await fs
			.stat(filePath + '.bak')
			.then(() => true)
			.catch(() => false);
		expect(exists).toBe(false);
	});
});

describe('Append crawl: list-mode rejection', () => {
	let filePath: string;
	let cwd: string;

	beforeAll(async () => {
		const baseline = await crawlAndPersist(['http://localhost:8010/scope/blog/']);
		filePath = baseline.filePath;
		cwd = baseline.cwd;

		// Mark the archive as list-mode via direct config update. `Archive.close`
		// won't re-write the .nitpicker tar when one already exists on disk, so
		// `write()` is required for the fromList=true change to be visible to
		// `Archive.open` in the next step.
		const archive = await Archive.open({ filePath, cwd });
		await archive.updateConfig({ fromList: true });
		await archive.write();
		await archive.close();
	}, 120_000);

	afterAll(async () => {
		await fs.rm(cwd, { recursive: true, force: true });
	});

	it('throws a helpful error when appending to a list-mode archive', async () => {
		await expect(
			CrawlerOrchestrator.append(filePath, ['http://localhost:8010/scope/docs/'], {
				cwd,
			}),
		).rejects.toThrow(/list-mode archive/);
	}, 120_000);
});
