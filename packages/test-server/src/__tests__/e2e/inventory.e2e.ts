import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Archive, computeFileSha256, CrawlerOrchestrator } from '@nitpicker/crawler';
import { listInventoryRuns, listUnusedResources } from '@nitpicker/query';
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
		// hidden-lp anchors to inner-link (which itself becomes
		// inventory-discovered), so the two form a size-2 cluster — NOT a
		// singleton — under the new `listIsolatedPages` definition.
		// Probe the raw `pages.source` column directly to pin the
		// inventory-seed label that `derivePageSource` writes for URLs
		// supplied via `--inventory`. The orphan-set behaviour is covered
		// separately by `compute-isolated-clusters.spec.ts`.
		const knex = accessor.getKnex();
		const [row] = (await knex('pages')
			.select('source')
			.where('url', 'http://localhost:8010/inventory/hidden-lp')) as {
			source: string;
		}[];
		expect(row, 'hidden-lp must have been inserted by --inventory').toBeDefined();
		expect(row?.source).toBe('inventory-seed');
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

	it('exposes the run via the public `listInventoryRuns` API (read-side integration)', async () => {
		// Direct-knex assertions below pin the table schema; this one
		// pins the public API integration: CLI / MCP / viewer all call
		// listInventoryRuns rather than reaching for raw SQL, so the
		// helper's column subset + sort order must match what the
		// orchestrator writes.
		const { items, total } = await listInventoryRuns(accessor);
		expect(total).toBe(1);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			total_lines: 2,
			new_pages: 1,
			new_resources: 1,
			scope_skipped: 0,
		});
		expect(items[0]?.list_label).toMatch(/^inventory-/);
		expect(typeof items[0]?.id).toBe('number');
	});

	it('records one inventory_runs row per successful --inventory invocation with the expected aggregate counts', async () => {
		// Phase 1 audit-log contract. The beforeAll inventory pass above
		// fed two URLs (1 HTML seed + 1 non-HTML resource) into the same
		// archive; the orchestrator MUST have written one `inventory_runs`
		// row with matching aggregates so client conversations of the
		// form "did we apply this list" have an in-archive answer.
		const knex = accessor.getKnex();
		const rows = (await knex('inventory_runs')
			.select('*')
			.orderBy('ran_at', 'desc')) as Array<{
			id: number;
			ran_at: string;
			list_label: string | null;
			source_file_sha256: string | null;
			total_lines: number | null;
			new_pages: number | null;
			new_resources: number | null;
			scope_skipped: number | null;
			notes: string | null;
		}>;
		expect(rows).toHaveLength(1);
		const [row] = rows;
		expect(row.ran_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(row.list_label).toMatch(/^inventory-/);
		expect(row.total_lines).toBe(2);
		expect(row.new_pages).toBe(1);
		expect(row.new_resources).toBe(1);
		expect(row.scope_skipped).toBe(0);
		// `source_file_sha256` is populated by the CLI's `inventoryCrawl`
		// plumbing, which the test invokes directly at the orchestrator
		// level — expected NULL for this programmatic call. sha256
		// presence is exercised by a dedicated describe block below that
		// goes through a tmp txt file.
		expect(row.source_file_sha256).toBeNull();
	});
});

describe('Inventory crawl run-audit fingerprint (with source file sha256)', () => {
	let filePath: string;
	let cwd: string;
	let listFilePath: string;
	let expectedSha256: string;
	let accessor: Archive;

	beforeAll(async () => {
		const baseline = await crawlAndPersist(['http://localhost:8010/']);
		filePath = baseline.filePath;
		cwd = baseline.cwd;

		// Write a real txt list under cwd. Two URLs — one HTML seed, one
		// non-HTML resource. The CLI normally hashes the file; this
		// e2e simulates that boundary by calling `computeFileSha256`
		// here and passing the digest to `inventory()` (the orchestrator
		// boundary deliberately does NOT receive the path post-lift).
		listFilePath = path.join(cwd, 'inventory-list.txt');
		const listBody = [
			'http://localhost:8010/inventory/hidden-lp',
			'http://localhost:8010/inventory/orphan.pdf',
		].join('\n');
		await fs.writeFile(listFilePath, listBody);

		// Compute the expected sha256 INDEPENDENTLY (= via Node's
		// `crypto.createHash`) so the assertion below is a content-
		// equality check, not a vacuous `^[0-9a-f]{64}$` shape check.
		// A regression where `computeFileSha256` hashes the wrong input
		// (e.g. the path string instead of the file body) gets caught.
		expectedSha256 = crypto.createHash('sha256').update(listBody).digest('hex');

		const sourceFileSha256 = await computeFileSha256(listFilePath);

		const orchestrator = await CrawlerOrchestrator.inventory(
			filePath,
			[
				'http://localhost:8010/inventory/hidden-lp',
				'http://localhost:8010/inventory/orphan.pdf',
			],
			{ cwd },
			undefined,
			sourceFileSha256,
		);
		await orchestrator.write();
		await orchestrator.archive.close();
		orchestrator.garbageCollect();

		accessor = await Archive.open({ filePath, cwd });
	}, 120_000);

	afterAll(async () => {
		if (accessor) {
			await accessor.close();
		}
		await fs.rm(cwd, { recursive: true, force: true });
	});

	it('records the sha256 that matches the byte content of the supplied list file (content-equality, not just shape)', async () => {
		const knex = accessor.getKnex();
		const [row] = (await knex('inventory_runs')
			.select('source_file_sha256')
			.orderBy('ran_at', 'desc')) as Array<{
			source_file_sha256: string | null;
		}>;
		// Equality (not shape): regression-proof against an
		// implementation that hashes the wrong bytes / the path string
		// / a buffered slice / etc. The expected digest was computed
		// independently above from the same body written to the file.
		expect(row.source_file_sha256).toBe(expectedSha256);
	});
});

describe('Inventory crawl noop run (all URLs already in archive)', () => {
	let filePath: string;
	let cwd: string;
	let accessor: Archive;

	beforeAll(async () => {
		// Baseline crawl reaches `/` and `/about` (anchored from index).
		const baseline = await crawlAndPersist(['http://localhost:8010/']);
		filePath = baseline.filePath;
		cwd = baseline.cwd;

		// Inventory with a URL that the baseline crawl already covered —
		// the orchestrator's existing-URL filter (`getExistingPageUrls`)
		// drops it before any work happens, so this is the noop branch.
		const orchestrator = await CrawlerOrchestrator.inventory(
			filePath,
			['http://localhost:8010/'],
			{ cwd },
		);
		await orchestrator.write();
		await orchestrator.archive.close();
		orchestrator.garbageCollect();

		accessor = await Archive.open({ filePath, cwd });
	}, 60_000);

	afterAll(async () => {
		if (accessor) {
			await accessor.close();
		}
		await fs.rm(cwd, { recursive: true, force: true });
	});

	it('does NOT write an inventory_runs row on the noop early-return path (Phase 1 caveat pin)', async () => {
		// Phase 1 trade-off: the noop branch doesn't take a `.bak`, so a
		// DB write here would risk tar-rewrite corruption on interrupt.
		// We skip the audit row entirely instead. Pinned so a future
		// change that adds `.bak` to the noop path can lift this and
		// catch the lift in test review.
		const knex = accessor.getKnex();
		const rows = await knex('inventory_runs').select('id');
		expect(rows).toHaveLength(0);
	});
});
