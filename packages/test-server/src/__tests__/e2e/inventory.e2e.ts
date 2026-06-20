import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Archive, CrawlerOrchestrator } from '@nitpicker/crawler';
import { listIsolatedPages, listUnusedResources } from '@nitpicker/query';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Run a baseline crawl rooted at the test-server top page, then close the
 * archive so the caller can re-open it via `Archive.open` / `inventory()`.
 * The baseline reaches `/`, `/about`, and a handful of resource URLs — but
 * NOT the `/inventory/*` fixture routes (they are deliberately unlinked).
 * @param urls - One or more URLs to crawl.
 * @returns Paths to the produced archive and its cwd.
 */
async function crawlAndPersist(
	urls: string[],
): Promise<{ filePath: string; cwd: string }> {
	const cwd = path.join(os.tmpdir(), `nitpicker-inventory-${crypto.randomUUID()}`);
	await fs.mkdir(cwd, { recursive: true });

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

	return { filePath, cwd };
}

describe('Inventory crawl', () => {
	let filePath: string;
	let cwd: string;
	let accessor: Archive;

	beforeAll(async () => {
		// 1) Baseline crawl reaches only the top page and its anchors —
		//    /inventory/* routes are never linked from the crawl-reachable graph.
		const baseline = await crawlAndPersist(['http://localhost:8010/']);
		filePath = baseline.filePath;
		cwd = baseline.cwd;

		// 2) Inventory pass with both an HTML URL and a non-HTML URL the
		//    crawl could not reach. The HTML one (hidden-lp) should be
		//    rendered + drive recursive discovery of inner-link; the PDF
		//    should be HEAD-only and land directly in resources.
		const orchestrator = await CrawlerOrchestrator.inventory(
			filePath,
			[
				'http://localhost:8010/inventory/hidden-lp',
				'http://localhost:8010/inventory/orphan.pdf',
			],
			{ cwd },
		);
		await orchestrator.write();
		await orchestrator.archive.close();
		orchestrator.garbageCollect();

		// Re-open for read-side assertions via the writer-side `Archive.open`
		// (it expands the tar into a working tmpDir, then we close it after
		// the suite). `Archive.connect` only works on stub directories, not
		// on packed `.nitpicker` tars.
		accessor = await Archive.open({ filePath, cwd });
	}, 120_000);

	afterAll(async () => {
		if (accessor) {
			await accessor.close();
		}
		await fs.rm(cwd, { recursive: true, force: true });
	});

	it('labels the URL-list HTML page as inventory-seed', async () => {
		const rows = await listIsolatedPages(accessor, { limit: 50 });
		const hidden = rows.items.find(
			(row) => row.url === 'http://localhost:8010/inventory/hidden-lp',
		);
		expect(hidden, 'hidden-lp must be present in isolated pages').toBeDefined();
		expect(hidden?.source).toBe('inventory-seed');
	});

	it('labels pages discovered by following links from a seed as inventory-discovered', async () => {
		// inner-link is anchored from hidden-lp, so by definition it is NOT
		// isolated — the listIsolatedPages helper rightfully filters it out.
		// Probe the raw `pages` row directly to verify the source label was
		// written; this is the only assertion that nails down the
		// `derivePageSource` → `Archive.setPage` → DB INSERT path for the
		// inventory-discovered case.
		const knex = accessor.getKnex();
		const [row] = (await knex('pages')
			.select('source')
			.where('url', 'http://localhost:8010/inventory/inner-link')) as {
			source: string;
		}[];
		expect(
			row,
			'inner-link must have been inserted by the recursive crawl',
		).toBeDefined();
		expect(row?.source).toBe('inventory-discovered');
	});

	it('records a non-HTML URL from the inventory list directly in resources as inventory-seed', async () => {
		const rows = await listUnusedResources(accessor, { limit: 50 });
		const orphan = rows.items.find(
			(row) => row.url === 'http://localhost:8010/inventory/orphan.pdf',
		);
		expect(orphan, 'orphan.pdf must be present in unused resources').toBeDefined();
		expect(orphan?.source).toBe('inventory-seed');
		// New behaviour: the orchestrator no longer fires a HEAD pre-flight per
		// URL, so non-HTML inventory entries land with NULL metadata. The
		// extension-based classification is the contract here — `query
		// unused-resources` still surfaces the row by referrer-count = 0, and a
		// downstream `--retry-failed` (or a re-`--inventory`) can populate
		// status / contentType later if needed. Asserting `null` pins the
		// regression: if we ever restore HEAD-based metadata, this test must
		// be updated deliberately.
		expect(orphan?.contentType).toBeNull();
		expect(orphan?.status).toBeNull();
	});

	// Note: a "second inventory pass keeps the existing source label"
	// scenario is intentionally left out here. The non-destructive property
	// is enforced at the SQL layer — `#getIdByUrl`'s `ON CONFLICT IGNORE`
	// path is exercised by the migration / database specs, and the
	// existing-URL filter (`getExistingPageUrls`) keeps the second pass
	// from even reaching the INSERT — so an E2E re-pass would only retest
	// what those unit tests already cover, at the cost of running a full
	// browser-render crawl twice in CI.
});
