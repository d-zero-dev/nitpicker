import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Archive, CrawlerOrchestrator, computeFileSha256 } from '@nitpicker/crawler';
import { listInventoryRuns, listUnusedResources } from '@nitpicker/query';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SERVER_ORIGIN, TEST_SERVER_PORT } from './test-server-port.js';

/**
 * Run a baseline crawl rooted at the test-server top page, then close the
 * archive so the caller can re-open it via `Archive.open` / `inventory()`.
 * The baseline reaches `/`, `/about`, and a handful of resource URLs — but
 * NOT the `/inventory/*` fixture routes (they are deliberately unlinked).
 * @param urls - One or more URLs to crawl.
 * @param options - Extra crawl config merged over the defaults (e.g. `excludes` persisted into the archive).
 * @returns Paths to the produced archive and its cwd.
 */
async function crawlAndPersist(
	urls: string[],
	options: Parameters<typeof CrawlerOrchestrator.crawling>[1] = {},
): Promise<{ filePath: string; cwd: string }> {
	const cwd = path.join(os.tmpdir(), `nitpicker-inventory-${crypto.randomUUID()}`);
	await fs.mkdir(cwd, { recursive: true });

	const orchestrator = await CrawlerOrchestrator.crawling(urls, {
		cwd,
		interval: 0,
		parallels: 1,
		image: false,
		fetchExternal: false,
		...options,
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
		const baseline = await crawlAndPersist([`${TEST_SERVER_ORIGIN}/`]);
		filePath = baseline.filePath;
		cwd = baseline.cwd;

		// 2) Inventory pass with both an HTML URL and a non-HTML URL the
		//    crawl could not reach. The HTML one (hidden-lp) should be
		//    rendered + drive recursive discovery of inner-link; the PDF
		//    should be HEAD-only and land directly in resources.
		const orchestrator = await CrawlerOrchestrator.inventory(
			filePath,
			[
				`${TEST_SERVER_ORIGIN}/inventory/hidden-lp`,
				`${TEST_SERVER_ORIGIN}/inventory/orphan.pdf`,
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
		// singleton — under `listIsolatedPages`'s definition.
		// Probe the raw `pages.source` column directly to pin the
		// inventory-seed label that `derivePageSource` writes for URLs
		// supplied via `--inventory`. The orphan-set behaviour is covered
		// separately by `compute-isolated-clusters.spec.ts`.
		const knex = accessor.getKnex();
		const [row] = (await knex('content_items as ci')
			.join('url_refs as ur', 'ci.url_id', 'ur.id')
			.select('ci.source as source')
			.where('ur.url', `${TEST_SERVER_ORIGIN}/inventory/hidden-lp`)) as {
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
		const [row] = (await knex('content_items as ci')
			.join('url_refs as ur', 'ci.url_id', 'ur.id')
			.select('ci.source as source')
			.where('ur.url', `${TEST_SERVER_ORIGIN}/inventory/inner-link`)) as {
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
			(row) => row.url === `${TEST_SERVER_ORIGIN}/inventory/orphan.pdf`,
		);
		expect(orphan, 'orphan.pdf must be present in unused resources').toBeDefined();
		expect(orphan?.source).toBe('inventory-seed');
		// The orchestrator fires no HEAD pre-flight per URL, so non-HTML
		// inventory entries land with NULL metadata. The extension-based
		// classification is the contract here — `query unused-resources`
		// still surfaces the row by referrer-count = 0, and a downstream
		// `--retry-failed` (or a re-`--inventory`) can populate
		// status / contentType later if needed. Asserting `null` pins the
		// contract: introducing HEAD-based metadata would have to update
		// this test deliberately.
		expect(orphan?.contentType).toBeNull();
		expect(orphan?.status).toBeNull();
	});

	// Note: a "second inventory pass keeps the existing source label"
	// scenario is intentionally left out here. The non-destructive property
	// is enforced at the SQL layer — `resolveContentItemId`'s insert-only
	// `source` semantics are exercised by the migration / database specs, and the
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
			exclude_skipped: 0,
		});
		expect(items[0]?.list_label).toMatch(/^inventory-/);
		expect(typeof items[0]?.id).toBe('number');
	});

	it('records one inventory_runs row per successful --inventory invocation with the expected aggregate counts', async () => {
		// Audit-log contract. The beforeAll inventory pass above
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
			exclude_skipped: number | null;
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
		expect(row.exclude_skipped).toBe(0);
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
	let listBytes: Buffer;
	let expectedSha256: string;
	let accessor: Archive;

	beforeAll(async () => {
		const baseline = await crawlAndPersist([`${TEST_SERVER_ORIGIN}/`]);
		filePath = baseline.filePath;
		cwd = baseline.cwd;

		// Write a real txt list under cwd. Two URLs — one HTML seed, one
		// non-HTML resource. The CLI normally reads this file once (as raw
		// bytes) and derives the digest from that buffer; this e2e simulates
		// that boundary directly (the orchestrator boundary deliberately
		// does NOT receive the path — see `InventorySource` JSDoc).
		listFilePath = path.join(cwd, 'inventory-list.txt');
		const listBody = [
			`${TEST_SERVER_ORIGIN}/inventory/hidden-lp`,
			`${TEST_SERVER_ORIGIN}/inventory/orphan.pdf`,
		].join('\n');
		listBytes = Buffer.from(listBody);
		await fs.writeFile(listFilePath, listBytes);

		// Compute the expected sha256 INDEPENDENTLY (= via Node's
		// `crypto.createHash`) so the assertion below is a content-
		// equality check, not a vacuous `^[0-9a-f]{64}$` shape check.
		// A regression where `computeFileSha256` hashes the wrong input
		// (e.g. the path string instead of the file body) gets caught.
		expectedSha256 = crypto.createHash('sha256').update(listBytes).digest('hex');

		const sha256 = computeFileSha256(listBytes);

		const orchestrator = await CrawlerOrchestrator.inventory(
			filePath,
			[
				`${TEST_SERVER_ORIGIN}/inventory/hidden-lp`,
				`${TEST_SERVER_ORIGIN}/inventory/orphan.pdf`,
			],
			{ cwd },
			undefined,
			{ sha256, bytes: listBytes, invalidLineCount: 0 },
		);
		await orchestrator.write();
		await orchestrator.archive.close();
		orchestrator.garbageCollect();

		// `openPluginData: true` — this describe block's tests read the
		// saved `inventory/<sha256>.txt` via `getData`, which needs the
		// non-`db.sqlite` tar entries actually extracted into tmpDir.
		accessor = await Archive.open({ filePath, cwd, openPluginData: true });
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

	it('archives the exact source list bytes under inventory/<sha256>.txt (issue #99)', async () => {
		// Content equality against the original file body — not just
		// "some file exists" — pins that the saved copy is byte-identical
		// to what was fed in.
		const saved = await accessor.getData(`inventory/${expectedSha256}`, 'txt');
		expect(saved).toBe(listBytes.toString('utf8'));
	});

	it('survives a second inventory pass on the same archive (openPluginData fix, issue #99)', async () => {
		// Regression guard for the `openPluginData` bug: `Archive.open`
		// without it only extracts `db.sqlite`, so a second writer-mode
		// open + `write()` would tar back a tmpDir missing the saved list
		// and silently drop it. Re-running `--inventory` with the exact
		// same list hits the no-op early return (every URL already known)
		// — the interesting assertion is that the file saved by the FIRST
		// run (in `beforeAll`, under `cwd`) is still present after this
		// SECOND open/write cycle.
		//
		// A separate `secondCwd` is used for the writer-mode open/close
		// below so it does not contend for the archive lock with the
		// `accessor` read handle this describe block keeps open until
		// `afterAll`.
		const secondCwd = `${cwd}-second-pass`;
		await fs.mkdir(secondCwd, { recursive: true });
		try {
			const orchestrator = await CrawlerOrchestrator.inventory(
				filePath,
				[
					`${TEST_SERVER_ORIGIN}/inventory/hidden-lp`,
					`${TEST_SERVER_ORIGIN}/inventory/orphan.pdf`,
				],
				{ cwd: secondCwd },
				undefined,
				{ sha256: expectedSha256, bytes: listBytes, invalidLineCount: 0 },
			);
			await orchestrator.write();
			await orchestrator.archive.close();
			orchestrator.garbageCollect();

			const reopenedAccessor = await Archive.open({
				filePath,
				cwd: secondCwd,
				openPluginData: true,
			});
			try {
				const saved = await reopenedAccessor.getData(
					`inventory/${expectedSha256}`,
					'txt',
				);
				expect(saved).toBe(listBytes.toString('utf8'));
			} finally {
				await reopenedAccessor.close();
			}
		} finally {
			await fs.rm(secondCwd, { recursive: true, force: true });
		}
	});
});

describe('Inventory pre-insert survives interrupted scrape (#121)', () => {
	// Regression test for issue #121. Before the fix, HTML seeds lived only in
	// the Crawler's in-memory `LinkList` until `setPage` ran — a Ctrl+C between
	// dealer pick and `setPage` lost the URL with no archive trace, and
	// `crawl --resume` could not recover it because the strict-pending set
	// requires a `pages` row. The fix pre-inserts seeds as
	// `scraped=0, source='inventory-seed'` *before* the scrape phase, so the
	// strict pending set (`OR p.source != 'crawled'`) picks them up on resume.
	//
	// We simulate the Ctrl+C by passing an `initializedCallback` that calls
	// `orchestrator.abort()` right before the dealer launches — the aborted
	// crawler's `crawlEnd` fires immediately without rendering any seed, so
	// the post-condition is "ingestion happened, scrape didn't". Then we
	// re-open the archive and assert the strict-pending set recovers the seed.
	//
	// NOTE: this test pins the *pre-insert durability* property. It does
	// NOT exercise the post-ingestion `archive.write()` recovery branch
	// that fires when the scrape phase throws a *non-abort* error
	// (puppeteer crash, DB lock, init callback throw). That recovery
	// path is exercised by the separate "Inventory scrape-phase failure
	// persists ingested state" describe below.
	let filePath: string;
	let cwd: string;
	let accessor: Archive;

	beforeAll(async () => {
		const baseline = await crawlAndPersist([`${TEST_SERVER_ORIGIN}/`]);
		filePath = baseline.filePath;
		cwd = baseline.cwd;

		const orchestrator = await CrawlerOrchestrator.inventory(
			filePath,
			[
				// Two HTML seeds to make sure the assertion is not a single-row
				// coincidence — both must show up in the strict pending set.
				`${TEST_SERVER_ORIGIN}/inventory/hidden-lp`,
				`${TEST_SERVER_ORIGIN}/inventory/inner-link`,
			],
			{ cwd },
			(orch) => {
				// `initializedCallback` runs after `crawler.resume(pending, …)`
				// but before `orchestrator.crawling([])` dispatches the dealer.
				// Aborting here is the cleanest in-process proxy for a Ctrl+C
				// landing in that window.
				orch.abort();
			},
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

	it('pre-inserts every HTML seed into pages with scraped=0 source=inventory-seed', async () => {
		// The load-bearing assertion: even though the dealer never scraped a
		// single seed, every URL is durably tracked as an `inventory-seed`
		// placeholder in `pages`. Pre-#121, these rows would not exist.
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
	});

	it('exposes the seeds in the strict pending set so --resume recovers them', async () => {
		// The fix's whole point: `getCrawlingState().pending` must include
		// the pre-inserted seeds via the `OR p.source != 'crawled'` clause,
		// even though no anchor row references them. Without this, an
		// interrupted inventory pass is irrecoverable.
		const { pending } = await accessor.getCrawlingState();
		expect(pending.toSorted()).toEqual([
			`${TEST_SERVER_ORIGIN}/inventory/hidden-lp`,
			`${TEST_SERVER_ORIGIN}/inventory/inner-link`,
		]);
	});

	it('writes the inventory_runs audit row inside the ingestion phase (before scrape)', async () => {
		// Audit row is written in the `.bak`-protected ingestion phase, so
		// it survives a Ctrl+C in the scrape phase — operators can still
		// answer "did we run inventory on this archive" even though no
		// seed was rendered.
		const knex = accessor.getKnex();
		const rows = (await knex('inventory_runs').select('*')) as Array<{
			total_lines: number | null;
			new_pages: number | null;
			new_resources: number | null;
		}>;
		expect(rows).toHaveLength(1);
		expect(rows[0]?.total_lines).toBe(2);
		expect(rows[0]?.new_pages).toBe(2);
		expect(rows[0]?.new_resources).toBe(0);
	});
});

describe('Inventory scrape-phase failure persists ingested state (#121 recovery path)', () => {
	// Regression test for the post-ingestion recovery branch:
	// when scrape phase throws *after* ingestion
	// completes (`.bak` is gone), the orchestrator must persist `tmpDir`
	// to the `.nitpicker` tar via `archive.write()` before unwinding —
	// otherwise the outer catch's `archive.close()` would see the original
	// archive file still on disk, hit the `remove(tmpDir)` branch of
	// `Archive.#runFullClose`, and silently wipe every pre-inserted
	// `inventory-seed` row + the `inventory_runs` audit row.
	//
	// We drive the scrape-phase failure by throwing inside
	// `initializedCallback`, which fires *after* the ingestion-complete
	// flag is set and the `.bak` is unlinked but *before* the dealer
	// dispatches. That lands the throw squarely in the scrape-phase
	// catch and exercises the `archive.write()` + `releaseHandle()`
	// recovery path that this test pins.
	let filePath: string;
	let cwd: string;

	beforeAll(async () => {
		const baseline = await crawlAndPersist([`${TEST_SERVER_ORIGIN}/`]);
		filePath = baseline.filePath;
		cwd = baseline.cwd;

		const scrapePhaseError = new Error('simulated scrape-phase failure');
		await expect(
			CrawlerOrchestrator.inventory(
				filePath,
				[
					`${TEST_SERVER_ORIGIN}/inventory/hidden-lp`,
					`${TEST_SERVER_ORIGIN}/inventory/inner-link`,
				],
				{ cwd },
				() => {
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

	it('persists pre-inserted inventory-seed rows to the .nitpicker tar despite the scrape throw', async () => {
		// The load-bearing assertion: after the scrape-phase throw, the
		// orchestrator's catch must call `archive.write()` to tar `tmpDir`
		// into the `.nitpicker` file. If that call were missing (or if the
		// `ingestionComplete=true` guard fell through to the `.bak` restore
		// branch), re-opening the archive would show zero `inventory-seed`
		// rows. The pre-insert durability E2E above only exercises the abort
		// path, which short-circuits before reaching this branch.
		const accessor = await Archive.open({ filePath, cwd });
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

	it('persists the inventory_runs audit row despite the scrape throw', async () => {
		// Audit row was written before the throw (inside the ingestion
		// phase). The `archive.write()` recovery flush must carry it
		// through to the on-disk archive, otherwise the operator has no
		// record that the inventory pass ever started.
		const accessor = await Archive.open({ filePath, cwd });
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
});

describe('Inventory http/https dedup keeps a single inventory-seed row per origin (#121)', () => {
	// Edge-case pin for the dedup boundary added in `inventory()` —
	// `protocolAgnosticKey` is the only thing that keeps an inventory
	// list with cross-scheme duplicates from creating an orphan
	// `pages` row. Without this dedup, the dealer's `seenInitial`
	// would collapse both to one URL and only scrape one, leaving the
	// other stuck at `scraped=0, source='inventory-seed'` forever and
	// indistinguishable from a real recovery candidate.
	let filePath: string;
	let cwd: string;
	let accessor: Archive;

	beforeAll(async () => {
		const baseline = await crawlAndPersist([`${TEST_SERVER_ORIGIN}/`]);
		filePath = baseline.filePath;
		cwd = baseline.cwd;

		const orchestrator = await CrawlerOrchestrator.inventory(
			filePath,
			[
				// Same URL with two schemes. Without dedup, both would
				// pass `getExistingPageUrls` (which matches exact `url`)
				// and produce two `pages` rows.
				`${TEST_SERVER_ORIGIN}/inventory/hidden-lp`,
				`https://localhost:${TEST_SERVER_PORT}/inventory/hidden-lp`,
			],
			{ cwd },
			(orch) => {
				// Skip scrape to keep the test deterministic — we only
				// care about the dedup at insert time.
				orch.abort();
			},
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

	it('creates exactly one inventory-seed row across http/https duplicates', async () => {
		const knex = accessor.getKnex();
		const rows = (await knex('content_items as ci')
			.join('url_refs as ur', 'ci.url_id', 'ur.id')
			.select('ur.url as url', 'ci.source as source')
			.whereIn('ur.url', [
				`${TEST_SERVER_ORIGIN}/inventory/hidden-lp`,
				`https://localhost:${TEST_SERVER_PORT}/inventory/hidden-lp`,
			])) as Array<{ url: string; source: string }>;
		// First-seen wins: the http scheme was supplied first so it
		// survives the dedup. The order is documented contract for the
		// dedup helper — if it ever needs to flip, this test catches it.
		expect(rows).toHaveLength(1);
		expect(rows[0]?.url).toBe(`${TEST_SERVER_ORIGIN}/inventory/hidden-lp`);
		expect(rows[0]?.source).toBe('inventory-seed');
	});
});

describe('Inventory crawl noop run (all URLs already in archive)', () => {
	let filePath: string;
	let cwd: string;
	let accessor: Archive;

	beforeAll(async () => {
		// Baseline crawl reaches `/` and `/about` (anchored from index).
		const baseline = await crawlAndPersist([`${TEST_SERVER_ORIGIN}/`]);
		filePath = baseline.filePath;
		cwd = baseline.cwd;

		// Inventory with a URL that the baseline crawl already covered —
		// the orchestrator's existing-URL filter (`getExistingPageUrls`)
		// drops it before any work happens, so this is the noop branch.
		const orchestrator = await CrawlerOrchestrator.inventory(
			filePath,
			[`${TEST_SERVER_ORIGIN}/`],
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

	it('does NOT write an inventory_runs row on the noop early-return path (known caveat pin)', async () => {
		// Deliberate trade-off: the noop branch doesn't take a `.bak`, so a
		// DB write here would risk tar-rewrite corruption on interrupt.
		// We skip the audit row entirely instead. Pinned so a future
		// change that adds `.bak` to the noop path can lift this and
		// catch the lift in test review.
		const knex = accessor.getKnex();
		const rows = await knex('inventory_runs').select('id');
		expect(rows).toHaveLength(0);
	});
});

describe('Inventory crawl applies the archived excludes / excludeUrls (issue #260)', () => {
	// The ingestion-side counterpart of `exclude.e2e.ts`: URLs matching
	// the archive's exclusion config must reach the same terminal state
	// through `--inventory` that a link-discovered excluded URL reaches
	// in a normal crawl — a skipped page row, never an imported one.
	// Non-HTML URLs are the critical case: they are written to
	// `resources` without ever passing the crawler's fetch-time
	// `shouldSkipUrl` gate, so only the classification in `inventory()`
	// can stop them. The excluded URLs deliberately have no test-server
	// routes: nothing may ever fetch them.
	let filePath: string;
	let cwd: string;
	let accessor: Archive;

	beforeAll(async () => {
		const baseline = await crawlAndPersist([`${TEST_SERVER_ORIGIN}/`], {
			excludes: ['/inventory/private/*'],
			excludeUrls: [`${TEST_SERVER_ORIGIN}/inventory/legacy`],
		});
		filePath = baseline.filePath;
		cwd = baseline.cwd;

		// One glob-excluded non-HTML URL, one prefix-excluded HTML-looking
		// URL, one kept non-HTML URL. No surviving HTML seed → the
		// orchestrator takes the non-HTML-only branch and never launches a
		// browser, keeping this suite cheap.
		const orchestrator = await CrawlerOrchestrator.inventory(
			filePath,
			[
				`${TEST_SERVER_ORIGIN}/inventory/private/secret.pdf`,
				`${TEST_SERVER_ORIGIN}/inventory/legacy/old-page`,
				`${TEST_SERVER_ORIGIN}/inventory/orphan.pdf`,
			],
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

	it('records a glob-excluded non-HTML URL as a skipped page, not as a resource', async () => {
		const knex = accessor.getKnex();
		const resourceRows = await knex('resource_items as ri')
			.join('url_refs as ur', 'ri.url_id', 'ur.id')
			.select('ur.url as url')
			.where('ur.url', `${TEST_SERVER_ORIGIN}/inventory/private/secret.pdf`);
		expect(resourceRows).toHaveLength(0);

		const [pageRow] = (await knex('content_items as ci')
			.join('url_refs as ur', 'ci.url_id', 'ur.id')
			.select(
				'ci.scraped as scraped',
				'ci.is_skipped as isSkipped',
				'ci.skip_reason as skipReason',
				'ci.source as source',
			)
			.where('ur.url', `${TEST_SERVER_ORIGIN}/inventory/private/secret.pdf`)) as Array<{
			scraped: number;
			isSkipped: number;
			skipReason: string | null;
			source: string;
		}>;
		expect(pageRow, 'secret.pdf must be recorded as a skipped page').toBeDefined();
		expect(pageRow.scraped).toBe(1);
		expect(pageRow.isSkipped).toBe(1);
		expect(pageRow.skipReason).toBe('excluded');
		expect(pageRow.source).toBe('inventory-seed');
	});

	it('records a prefix-excluded HTML URL as a skipped page, not as a pending inventory seed', async () => {
		const knex = accessor.getKnex();
		const [pageRow] = (await knex('content_items as ci')
			.join('url_refs as ur', 'ci.url_id', 'ur.id')
			.select(
				'ci.scraped as scraped',
				'ci.is_skipped as isSkipped',
				'ci.skip_reason as skipReason',
				'ci.source as source',
			)
			.where('ur.url', `${TEST_SERVER_ORIGIN}/inventory/legacy/old-page`)) as Array<{
			scraped: number;
			isSkipped: number;
			skipReason: string | null;
			source: string;
		}>;
		expect(pageRow, 'legacy/old-page must be recorded as a skipped page').toBeDefined();
		// `scraped=1` pins the "terminal, not pending" contract: a later
		// `--resume` must not try to fetch this operator-excluded URL.
		expect(pageRow.scraped).toBe(1);
		expect(pageRow.isSkipped).toBe(1);
		expect(pageRow.skipReason).toBe('excluded');
		expect(pageRow.source).toBe('inventory-seed');
	});

	it('still ingests the non-excluded URL from the same list', async () => {
		const rows = await listUnusedResources(accessor, { limit: 50 });
		const orphan = rows.items.find(
			(row) => row.url === `${TEST_SERVER_ORIGIN}/inventory/orphan.pdf`,
		);
		expect(orphan, 'orphan.pdf must be present in unused resources').toBeDefined();
		expect(orphan?.source).toBe('inventory-seed');
	});

	it('separates the drop reasons on the audit row (exclude_skipped vs scope_skipped)', async () => {
		const { items, total } = await listInventoryRuns(accessor);
		expect(total).toBe(1);
		expect(items[0]).toMatchObject({
			total_lines: 3,
			new_pages: 0,
			new_resources: 1,
			scope_skipped: 0,
			exclude_skipped: 2,
		});
	});
});
