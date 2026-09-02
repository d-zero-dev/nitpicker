import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Archive, CrawlerOrchestrator } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SERVER_ORIGIN } from './test-server-port.js';

/**
 * Run a baseline crawl that creates a `.nitpicker` archive on disk, then
 * close it so the caller can re-open it via `Archive.open` — the same
 * pattern `retry-failed.e2e.ts` uses (`--recrawl`, like `--retry-failed`,
 * operates on an archive *file path*, not a live stub directory).
 * @param urls - One or more URLs to crawl.
 * @param options - Optional crawl configuration overrides.
 * @returns Paths to the produced archive and its cwd.
 */
async function crawlAndPersist(
	urls: string[],
	options: Record<string, unknown> = {},
): Promise<{ filePath: string; cwd: string }> {
	const cwd = path.join(os.tmpdir(), `nitpicker-recrawl-${crypto.randomUUID()}`);
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

describe('Recrawl: re-fetches listed pages that reference only each other', () => {
	let filePath: string;
	let cwd: string;
	let accessor: Archive;
	let rootLastCrawledAtBeforeRecrawl: number | null;
	let aboutLastCrawledAtBeforeRecrawl: number | null;

	beforeAll(async () => {
		// 1) Baseline crawl: `/` links to `/about` and `/about` links back to
		//    `/` — the two pages' only inbound `anchor_edges` rows are each
		//    other.
		const baseline = await crawlAndPersist([`${TEST_SERVER_ORIGIN}/`]);
		filePath = baseline.filePath;
		cwd = baseline.cwd;
		const baselineArchive = await Archive.open({ filePath, cwd });
		const baselinePages = await baselineArchive.getPages('page');
		rootLastCrawledAtBeforeRecrawl =
			baselinePages.find((p) => p.url.pathname === '/')?.lastCrawledAt ?? null;
		aboutLastCrawledAtBeforeRecrawl =
			baselinePages.find((p) => p.url.pathname === '/about')?.lastCrawledAt ?? null;
		expect(rootLastCrawledAtBeforeRecrawl).not.toBeNull();
		expect(aboutLastCrawledAtBeforeRecrawl).not.toBeNull();
		await baselineArchive.close();

		// 2) Recrawl both pages together. Resetting `/` deletes its outgoing
		//    anchor to `/about` and vice versa, so the strict-pending scan
		//    (`getCrawlingState`) alone would find neither page referenced —
		//    this is the regression `resetPagesByUrls`'s result must be
		//    merged into `Crawler#resume`'s pending set to avoid (see
		//    `CrawlerOrchestrator.recrawl`'s "Strict-pending gap" JSDoc). A
		//    novel URL (`/inventory/hidden-lp`, an existing fixture no page
		//    links to) is included too, to exercise reset + ingestion in the
		//    same pass.
		await new Promise((resolve) => setTimeout(resolve, 5));
		const orchestrator = await CrawlerOrchestrator.recrawl(
			filePath,
			[
				`${TEST_SERVER_ORIGIN}/`,
				`${TEST_SERVER_ORIGIN}/about`,
				`${TEST_SERVER_ORIGIN}/inventory/hidden-lp`,
			],
			{ cwd },
		);
		await orchestrator.write();
		await orchestrator.archive.close();
		orchestrator.garbageCollect();

		accessor = await Archive.open({ filePath, cwd });
	}, 240_000);

	afterAll(async () => {
		await accessor?.close();
		await fs.rm(cwd, { recursive: true, force: true });
	});

	it('both mutually-referencing pages are re-fetched, not silently dropped', async () => {
		const pages = await accessor.getPages('page');
		const root = pages.find((p) => p.url.pathname === '/');
		const about = pages.find((p) => p.url.pathname === '/about');
		expect(root).toBeDefined();
		expect(about).toBeDefined();
		expect(root!.lastCrawledAt).toBeGreaterThan(rootLastCrawledAtBeforeRecrawl!);
		expect(about!.lastCrawledAt).toBeGreaterThan(aboutLastCrawledAtBeforeRecrawl!);
	});

	it('a URL not yet tracked by the archive is imported as a new page', async () => {
		const pages = await accessor.getPages('page');
		const hiddenLp = pages.find((p) => p.url.pathname === '/inventory/hidden-lp');
		expect(hiddenLp).toBeDefined();
		expect(hiddenLp!.isExternal).toBe(false);
	});

	it('a page discovered only via the novel seed is followed recursively', async () => {
		const pages = await accessor.getPages('page');
		const innerLink = pages.find((p) => p.url.pathname === '/inventory/inner-link');
		expect(innerLink).toBeDefined();
	});

	it('removes the .bak backup file once the recrawl succeeds', async () => {
		const exists = await fs
			.stat(filePath + '.bak')
			.then(() => true)
			.catch(() => false);
		expect(exists).toBe(false);
	});
});

describe('Recrawl: list-mode rejection', () => {
	let filePath: string;
	let cwd: string;

	beforeAll(async () => {
		const baseline = await crawlAndPersist([`${TEST_SERVER_ORIGIN}/`]);
		filePath = baseline.filePath;
		cwd = baseline.cwd;

		const archive = await Archive.open({ filePath, cwd });
		await archive.updateConfig({ fromList: true });
		await archive.write();
		await archive.close();
	}, 120_000);

	afterAll(async () => {
		await fs.rm(cwd, { recursive: true, force: true });
	});

	it('throws a helpful error when recrawling a list-mode archive', async () => {
		await expect(
			CrawlerOrchestrator.recrawl(filePath, [`${TEST_SERVER_ORIGIN}/`], { cwd }),
		).rejects.toThrow(
			'Cannot recrawl a list-mode archive: this archive was created with --list/--list-file and contains metadata-only pages. Create a fresh archive instead.',
		);
	}, 120_000);
});
