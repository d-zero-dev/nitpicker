import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Archive, CrawlerOrchestrator } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Run a baseline crawl that creates a `.nitpicker` archive on disk, then close
 * it so the caller can re-open it via `Archive.open`.
 * @param urls - One or more URLs to crawl.
 * @param options - Optional crawl configuration overrides.
 * @returns Paths to the produced archive and its cwd.
 */
async function crawlAndPersist(
	urls: string[],
	options: Record<string, unknown> = {},
): Promise<{ filePath: string; cwd: string }> {
	const cwd = path.join(os.tmpdir(), `nitpicker-retry-${crypto.randomUUID()}`);
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

/**
 * Toggle the `/flaky/recoverable` route between failing (500) and healed (200).
 * @param state - `'heal'` to serve 200, `'reset'` to serve 500.
 */
async function setFlakyState(state: 'heal' | 'reset'): Promise<void> {
	const res = await fetch(`http://localhost:8010/flaky/control/${state}`);
	await res.text();
}

describe('Retry failed crawl (recursive, default)', () => {
	let filePath: string;
	let cwd: string;
	let accessor: Archive;

	beforeAll(async () => {
		// 1) Baseline crawl while /flaky/recoverable returns 500. The page is
		//    recorded with status 500 and its (healed-only) child stays unseen.
		await setFlakyState('reset');
		const baseline = await crawlAndPersist(['http://localhost:8010/flaky/']);
		filePath = baseline.filePath;
		cwd = baseline.cwd;

		// 2) Heal the endpoint, then retry the failed pages. The 5xx page is
		//    reset, re-fetched as a 200, and its newly-exposed child is crawled.
		await setFlakyState('heal');
		const orchestrator = await CrawlerOrchestrator.retryFailed(filePath, { cwd });
		await orchestrator.write();
		await orchestrator.archive.close();
		orchestrator.garbageCollect();

		accessor = await Archive.open({ filePath, cwd });
	}, 240_000);

	afterAll(async () => {
		await accessor?.close();
		await fs.rm(cwd, { recursive: true, force: true });
		await setFlakyState('reset');
	});

	it('the recoverable 5xx page is re-fetched and now records status 200', async () => {
		const pages = await accessor.getPages('page');
		const recoverable = pages.find((p) => p.url.pathname === '/flaky/recoverable');
		expect(recoverable).toBeDefined();
		expect(recoverable!.status).toBe(200);
	});

	it('a URL discovered only after recovery is crawled as a full internal page', async () => {
		const pages = await accessor.getPages('page');
		const child = pages.find((p) => p.url.pathname === '/flaky/healed-child');
		expect(child).toBeDefined();
		expect(child!.isExternal).toBe(false);
		expect(child!.isTarget).toBe(true);
	});

	it('removes the .bak backup file once the retry succeeds', async () => {
		const exists = await fs
			.stat(filePath + '.bak')
			.then(() => true)
			.catch(() => false);
		expect(exists).toBe(false);
	});
});

describe('Retry failed crawl (--no-recursive)', () => {
	let filePath: string;
	let cwd: string;
	let accessor: Archive;

	beforeAll(async () => {
		await setFlakyState('reset');
		const baseline = await crawlAndPersist(['http://localhost:8010/flaky/']);
		filePath = baseline.filePath;
		cwd = baseline.cwd;

		await setFlakyState('heal');
		const orchestrator = await CrawlerOrchestrator.retryFailed(filePath, {
			cwd,
			recursive: false,
		});
		await orchestrator.write();
		await orchestrator.archive.close();
		orchestrator.garbageCollect();

		accessor = await Archive.open({ filePath, cwd });
	}, 240_000);

	afterAll(async () => {
		await accessor?.close();
		await fs.rm(cwd, { recursive: true, force: true });
		await setFlakyState('reset');
	});

	it('still re-fetches the failed page itself (status 200)', async () => {
		const pages = await accessor.getPages('page');
		const recoverable = pages.find((p) => p.url.pathname === '/flaky/recoverable');
		expect(recoverable).toBeDefined();
		expect(recoverable!.status).toBe(200);
	});

	it('does not crawl newly-discovered URLs as full pages', async () => {
		const pages = await accessor.getPages('page');
		const child = pages.find((p) => p.url.pathname === '/flaky/healed-child');
		expect(child).toBeUndefined();
	});
});

describe('Retry failed crawl: list-mode rejection', () => {
	let filePath: string;
	let cwd: string;

	beforeAll(async () => {
		await setFlakyState('reset');
		const baseline = await crawlAndPersist(['http://localhost:8010/flaky/']);
		filePath = baseline.filePath;
		cwd = baseline.cwd;

		const archive = await Archive.open({ filePath, cwd });
		await archive.updateConfig({ fromList: true });
		await archive.write();
		await archive.close();
	}, 120_000);

	afterAll(async () => {
		await fs.rm(cwd, { recursive: true, force: true });
		await setFlakyState('reset');
	});

	it('throws a helpful error when retrying a list-mode archive', async () => {
		await expect(CrawlerOrchestrator.retryFailed(filePath, { cwd })).rejects.toThrow(
			'Cannot retry a list-mode archive: this archive was created with --list/--list-file and contains metadata-only pages. Create a fresh archive instead.',
		);
	}, 120_000);
});
