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

describe('Recrawl scrape-phase failure leaves ingested state in the stub, unpackaged (#350 recovery path)', () => {
	// Mirrors `inventory.e2e.ts`'s identical describe — `recrawl()` shares
	// the exact same `ingestionComplete` catch structure as `inventory()`
	// (see `CrawlerOrchestrator.recrawl`'s JSDoc: "recrawl is retryFailed's
	// un-scrape combined with inventory's novel-URL ingestion"), so the
	// post-#350 removal of the salvage `archive.write()` applies here too.
	// A `.nitpicker` file on disk must always imply `pending === 0` — when
	// scrape phase throws *after* ingestion completes (`.bak` already
	// gone), the orchestrator's catch calls `archive.releaseHandle()` and
	// leaves the stub (tmpDir) on disk, un-packaged, instead of packaging
	// the original archive with the ingested-but-unscraped novel seed.
	//
	// We drive the scrape-phase failure by throwing inside
	// `initializedCallback`, which fires *after* the ingestion-complete
	// flag is set and the `.bak` is unlinked but *before* the dealer
	// dispatches (and before `#crawlUntilPendingClears` ever runs). We
	// capture the orchestrator via `initializedCallback` (before it
	// throws) so the test can inspect the stub afterward.
	let filePath: string;
	let cwd: string;
	let tmpDir: string;

	beforeAll(async () => {
		const baseline = await crawlAndPersist([`${TEST_SERVER_ORIGIN}/`]);
		filePath = baseline.filePath;
		cwd = baseline.cwd;

		const scrapePhaseError = new Error('simulated scrape-phase failure');
		await expect(
			CrawlerOrchestrator.recrawl(
				filePath,
				[
					// Both novel — `recrawl()` reaches the `ingestionComplete`
					// branch via the same novel-URL ingestion path `inventory()`
					// uses (no existing pages need resetting for this test).
					`${TEST_SERVER_ORIGIN}/inventory/hidden-lp`,
					`${TEST_SERVER_ORIGIN}/inventory/inner-link`,
				],
				{ cwd },
				(orch) => {
					tmpDir = orch.archive.tmpDir;
					// Throws *after* ingestion completes — exercises the
					// `ingestionComplete=true` branch of the orchestrator's
					// outer catch.
					throw scrapePhaseError;
				},
			),
		).rejects.toThrow('simulated scrape-phase failure');
	}, 60_000);

	afterAll(async () => {
		await fs.rm(cwd, { recursive: true, force: true });
	});

	// NOTE on ordering: the two stub-reading tests below run BEFORE "leaves
	// the original .nitpicker untouched" — see `inventory.e2e.ts`'s
	// identical note for why `Archive.open({ filePath, cwd })` reusing the
	// stub's tmpDir path would otherwise clobber it before those two tests
	// get to read it.
	it('persists pre-inserted inventory-seed rows in the stub tmpDir despite the scrape throw', async () => {
		const accessor = await Archive.connect(tmpDir);
		try {
			const knex = accessor.getKnex();
			const rows = (await knex('content_items as ci')
				.join('url_refs as ur', 'ci.url_id', 'ur.id')
				.select('ur.url as url', 'ci.source as source', 'ci.scraped as scraped')
				.whereIn('ur.url', [
					`${TEST_SERVER_ORIGIN}/inventory/hidden-lp`,
					`${TEST_SERVER_ORIGIN}/inventory/inner-link`,
				])
				.orderBy('ur.url')) as Array<{
				url: string;
				source: string;
				scraped: number;
			}>;
			expect(rows.map((r) => r.url)).toEqual([
				`${TEST_SERVER_ORIGIN}/inventory/hidden-lp`,
				`${TEST_SERVER_ORIGIN}/inventory/inner-link`,
			]);
			for (const row of rows) {
				expect(row.source).toBe('inventory-seed');
				expect(row.scraped).toBe(0);
			}
		} finally {
			await accessor.close();
		}
	});

	it('persists the inventory_runs audit row in the stub tmpDir despite the scrape throw', async () => {
		const accessor = await Archive.connect(tmpDir);
		try {
			const knex = accessor.getKnex();
			const rows = (await knex('inventory_runs').select('*')) as Array<{
				total_lines: number | null;
				new_pages: number | null;
			}>;
			expect(rows).toHaveLength(1);
			expect(rows[0]?.total_lines).toBe(2);
			expect(rows[0]?.new_pages).toBe(2);
		} finally {
			await accessor.close();
		}
	});

	it('leaves the original .nitpicker untouched — write() never ran, so it still has zero inventory-seed rows', async () => {
		// The load-bearing assertion for the new invariant: the original
		// archive (a pre-recrawl baseline with no `/inventory/*` routes)
		// must NOT show the seed rows this recrawl pass ingested. If
		// `write()` were still called here (the pre-#350 salvage path),
		// this archive would gain them and the invariant would not hold.
		// Runs LAST in this describe (see the ordering note above) —
		// `Archive.open` here reuses the stub's tmpDir path and destroys it
		// on close.
		const accessor = await Archive.open({ filePath, cwd });
		try {
			const knex = accessor.getKnex();
			const rows = (await knex('content_items as ci')
				.join('url_refs as ur', 'ci.url_id', 'ur.id')
				.select('ur.url as url')
				.whereIn('ur.url', [
					`${TEST_SERVER_ORIGIN}/inventory/hidden-lp`,
					`${TEST_SERVER_ORIGIN}/inventory/inner-link`,
				])) as Array<{ url: string }>;
			expect(rows).toHaveLength(0);
		} finally {
			await accessor.close();
		}
	});
});
