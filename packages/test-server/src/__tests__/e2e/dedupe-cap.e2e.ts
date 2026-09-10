import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Archive, CrawlerOrchestrator } from '@nitpicker/crawler';
import {
	buildViewerReadModel,
	getPageDetail,
	listDedupeCapEvents,
	listPages,
} from '@nitpicker/query';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';
import { TEST_SERVER_ORIGIN, TEST_SERVER_PORT } from './test-server-port.js';

/**
 * E2E coverage for issue #208: the self-generating same-cluster trap
 * (`/trap/date/{n}/` etc, served by `dedupe-cap-trap.ts`) and the two
 * mitigations built against it.
 *
 * - Always-on: the pagination predictor never emits a malformed URL
 *   (scientific notation / runaway digit growth) — see
 *   `generate-predicted-urls.spec.ts` for the exact numeric regression this
 *   backstops; this suite proves the same holds true end-to-end through a
 *   real crawl of a fixture that reproduces the trap shape.
 * - Opt-in (`--dedupe-cap`): `DedupeCapTracker` confirms a same-cluster
 *   trap and stops enqueueing further anchors for its shape, recording the
 *   confirmation in `dedupe_cap_events`.
 *
 * `parallels: 1` throughout — the cap-firing tests need strictly sequential
 * processing so exactly N pages are admitted before the shape caps; with
 * concurrent fetches, several already-in-flight anchors could slip past the
 * gate non-deterministically (the gate blocks new enqueues, not in-flight
 * work). Each fixture route (`dedupe-cap-trap.ts`) links to only TWO fixed
 * anchors — real Puppeteer launches per page make this suite's runtime
 * dominated by page count, and (per the threshold arithmetic below) two
 * member pages already exercise the cap.
 *
 * Threshold arithmetic (base `--dedupe-cap 3`, applies to every trap shape
 * below): the 1st observation of a shape always has `bodyHashMatches: false`
 * (nothing recorded yet to compare against — see `DedupeCapTracker`'s own
 * JSDoc), so only the `og:url`-mismatch halving applies: threshold =
 * ceil(3/2) = 2, count 1 < 2 → not capped. The 2nd observation matches the
 * recorded `metaSig`, so count = 2; for `/trap/date/` and `/trap/query/`
 * (identical body across every member) `bodyHashMatches` is now also true,
 * halving again: threshold = ceil(2/2) = 1, count 2 >= 1 → CAPPED, with
 * `observed_count: 2` and `effective_threshold: 1`. For `/trap/echo/`
 * (body echoes the value, so `bodyHashMatches` is never true) only the
 * `og:url` halving ever applies: threshold stays 2, count 2 >= 2 → CAPPED,
 * with `observed_count: 2` and `effective_threshold: 2`.
 *
 * Page-count nuance for `/trap/date/` and `/trap/echo/` (NOT `/trap/query/`
 * — see below): the fixture's two fixed anchors (e.g. years 2020, 2021) are
 * sequential integers, so `detectPaginationPattern` treats them as a valid
 * pagination pattern and — before either page has even been fetched, while
 * still processing the INDEX page's own anchors — enqueues ONE predicted
 * page (year 2022) via the pagination-prediction branch. This happens
 * before the tracker has any observations for the shape, so the cap cannot
 * have fired yet; by the time the cap DOES fire (after the 2nd real page is
 * observed), that one predicted page is already queued and gate 1 cannot
 * retroactively cancel it (it only blocks NEW enqueues). So the resulting
 * page count is 3 (2 real + 1 pre-capped predicted), not 2 — this predicted
 * page does NOT itself count as a THIRD tracker observation, because
 * `DedupeCapTracker#observe` no-ops once `#sticky` already has the shape
 * (confirmed by `observed_count` staying 2 below). `/trap/query/`'s anchors
 * differ only by query string (not a numeric path segment), so
 * `detectPaginationPattern` never fires for them and this nuance does not
 * apply there — its page count is not asserted for this reason.
 */
describe('dedupe-cap trap fixture (issue #208)', () => {
	let result: CrawlResult;

	afterAll(async () => {
		if (result) await cleanup(result);
	});

	it('--dedupe-cap 無しでも科学表記・異常な桁数のURLを一切生成しない', async () => {
		result = await crawl([`http://localhost:${TEST_SERVER_PORT}/trap/date/`], {
			parallels: 1,
		});
		const pages = await result.accessor.getPages('internal-page');
		const pathnames = pages.map((p) => p.url.pathname);
		for (const pathname of pathnames) {
			expect(pathname).not.toMatch(/e[+-]\d+/i);
			// The trap's own anchors are a fixed set of 4-digit years; any
			// path segment growing past a handful of digits would indicate
			// runaway extrapolation.
			expect(pathname).not.toMatch(/\d{6,}/);
		}
	}, 120_000);
});

describe('dedupe-cap trap fixture — --dedupe-cap opt-in (issue #208)', () => {
	let result: CrawlResult;

	afterAll(async () => {
		if (result) await cleanup(result);
	});

	it('同一メタデータ+同一bodyのtrapはbody_hash一致とog:url不一致の両シグナルで早期にcapする', async () => {
		result = await crawl([`http://localhost:${TEST_SERVER_PORT}/trap/date/`], {
			parallels: 1,
			dedupeCap: 3,
		});

		const pages = await result.accessor.getPages('internal-page');
		const trapPages = pages.filter((p) => /^\/trap\/date\/\d+\/$/.test(p.url.pathname));
		// 2 real anchors + 1 pre-capped predicted page — see this file's
		// top-level JSDoc "Page-count nuance" for why.
		expect(trapPages).toHaveLength(3);

		const { items, total } = await listDedupeCapEvents(result.accessor);
		expect(total).toBe(1);
		expect(items[0]?.shape_key).toContain('/trap/date/{n}/');
		expect(items[0]?.observed_count).toBe(2);
		expect(items[0]?.effective_threshold).toBe(1);
	}, 120_000);

	it('cap発火後、backfillDedupeCapEventIdが同一shapeの全ページをcontent_items.dedupe_cap_event_idでマークする', async () => {
		result = await crawl([`http://localhost:${TEST_SERVER_PORT}/trap/date/`], {
			parallels: 1,
			dedupeCap: 3,
		});

		const { items } = await listDedupeCapEvents(result.accessor);
		expect(items).toHaveLength(1);
		const shapeKey = items[0]!.shape_key;

		await buildViewerReadModel(result.archive);

		const { total, items: cappedPages } = await listPages(result.accessor, {
			isDedupeCapped: true,
		});
		// Same 3 pages (2 real + 1 pre-capped predicted) asserted by the
		// preceding test — every one of them shares this trap's shape.
		expect(total).toBe(3);
		for (const page of cappedPages) {
			expect(page.url).toMatch(/^http:\/\/localhost:\d+\/trap\/date\/\d+\/$/);
		}

		const detail = await getPageDetail(result.accessor, cappedPages[0]!.url);
		expect(detail!.isDedupeCapped).toBe(true);
		expect(detail!.dedupeCapShapeKey).toBe(shapeKey);
	}, 120_000);

	it('bodyがパラメータをエコーしてもmetaSigのみでcapする（body_hash加点が効かない変種）', async () => {
		result = await crawl([`http://localhost:${TEST_SERVER_PORT}/trap/echo/`], {
			parallels: 1,
			dedupeCap: 3,
		});

		const pages = await result.accessor.getPages('internal-page');
		const trapPages = pages.filter((p) => /^\/trap\/echo\/\d+\/$/.test(p.url.pathname));
		// 2 real anchors + 1 pre-capped predicted page — see this file's
		// top-level JSDoc "Page-count nuance" for why.
		expect(trapPages).toHaveLength(3);

		const { items, total } = await listDedupeCapEvents(result.accessor);
		expect(total).toBe(1);
		expect(items[0]?.shape_key).toContain('/trap/echo/{n}/');
		expect(items[0]?.observed_count).toBe(2);
		expect(items[0]?.effective_threshold).toBe(2);
	}, 120_000);

	it('クエリパラメータtrapもshapeKeyで畳み込まれてcapする', async () => {
		result = await crawl([`http://localhost:${TEST_SERVER_PORT}/trap/query/`], {
			parallels: 1,
			dedupeCap: 3,
		});

		const { items, total } = await listDedupeCapEvents(result.accessor);
		expect(total).toBe(1);
		expect(items[0]?.shape_key).toContain('{v}');
		expect(items[0]?.observed_count).toBe(2);
		expect(items[0]?.effective_threshold).toBe(1);
	}, 120_000);

	it('正当なページャ（各ページでtitleが異なる）はcapしない（false-positiveなし）', async () => {
		result = await crawl([`http://localhost:${TEST_SERVER_PORT}/pagination/`], {
			parallels: 1,
			dedupeCap: 3,
		});

		const pages = await result.accessor.getPages('internal-page');
		const paginationPages = pages.filter((p) =>
			p.url.pathname.startsWith('/pagination/page/'),
		);
		// 正当なページャなので dedupe-cap が無くても page/1〜page/10 全件が
		// 到達可能であることを確認（cap による誤検知で欠落していないこと）。
		expect(paginationPages).toHaveLength(10);

		const { total } = await listDedupeCapEvents(result.accessor);
		expect(total).toBe(0);
	}, 180_000);
});

/**
 * Toggles `/trap/replay/203/` (see `dedupe-cap-trap.ts`) between failing
 * (500) and healed (200) over HTTP, mirroring `retry-failed.e2e.ts`'s
 * `setFlakyState` — the healed/failing state lives in the test server's
 * process, independent of this test's own process/session boundaries.
 * @param state - `'heal'` to serve 200, `'reset'` to serve 500.
 */
async function setReplayMemberState(state: 'heal' | 'reset'): Promise<void> {
	const res = await fetch(`${TEST_SERVER_ORIGIN}/trap/replay/control/${state}`);
	await res.text();
}

describe('dedupe-cap trap fixture — prior-session counter replay (retry-failed burst fix)', () => {
	let filePath: string;
	let cwd: string;
	let accessor: Archive;

	beforeAll(async () => {
		// 1) Baseline crawl while `/trap/replay/203/` returns 500. Only
		//    907/501 are ever observed by `DedupeCapTracker` (203 fails
		//    before rendering any content) — 2 observations, and this
		//    shape's threshold from the 2nd observation onward is
		//    `ceil(dedupeCap/2) = 3` (no `og:url` tag on this fixture, so
		//    only the `body_hash`-match confidence signal ever halves the
		//    base cap — see `dedupe-cap-trap.ts`'s JSDoc), so 2 < 3 → NOT
		//    capped yet.
		await setReplayMemberState('reset');
		cwd = path.join(os.tmpdir(), `nitpicker-e2e-${crypto.randomUUID()}`);
		await fs.mkdir(cwd, { recursive: true });
		const baseline = await CrawlerOrchestrator.crawling(
			[`${TEST_SERVER_ORIGIN}/trap/replay/`],
			{ cwd, interval: 0, parallels: 1, image: false, dedupeCap: 6 },
		);
		filePath = baseline.archive.filePath;
		await baseline.write();
		await baseline.archive.close();
		baseline.garbageCollect();

		const afterSession1 = await Archive.open({ filePath, cwd });
		const { total: totalAfterSession1 } = await listDedupeCapEvents(afterSession1);
		expect(totalAfterSession1).toBe(0);
		await afterSession1.close();

		// 2) Heal 203, then retry the failed pages. Without the
		//    counter-replay fix, `--retry-failed` would restart this
		//    shape's counter at 0 and only ever see 203's single live
		//    observation (1 < 3, never capping) — this session-2-only
		//    count is exactly what the "observed_count: 3" assertion below
		//    rules out.
		await setReplayMemberState('heal');
		const retry = await CrawlerOrchestrator.retryFailed(filePath, {
			cwd,
			dedupeCap: 6,
		});
		await retry.write();
		await retry.archive.close();
		retry.garbageCollect();

		accessor = await Archive.open({ filePath, cwd });
	}, 240_000);

	afterAll(async () => {
		await accessor?.close();
		await fs.rm(cwd, { recursive: true, force: true });
		await setReplayMemberState('reset');
	});

	it('セッション1単独では閾値に届かず、セッション2のreplay込みの3件目の観測でcapが発火する', async () => {
		const { items, total } = await listDedupeCapEvents(accessor);
		expect(total).toBe(1);
		expect(items[0]?.shape_key).toContain('/trap/replay/{n}/');
		// 3 = 907 + 501 (replayed from session 1, no live observation this
		// session) + 203 (observed live in session 2). This is the
		// structural proof the replay contributed the prior 2 — a
		// session-2-only tracker could never reach 3 from a single retry.
		expect(items[0]?.observed_count).toBe(3);
		expect(items[0]?.effective_threshold).toBe(3);
	});

	it('203はhealされて通常どおり200で取得できている', async () => {
		const pages = await accessor.getPages('page');
		const healedPage = pages.find((p) => p.url.pathname === '/trap/replay/203/');
		expect(healedPage).toBeDefined();
		expect(healedPage!.status).toBe(200);
	});
});

describe('dedupe-cap trap fixture — resetFailedPages excludes a confirmed-capped shape (retry-failed burst fix)', () => {
	let filePath: string;
	let cwd: string;
	let accessor: Archive;

	beforeAll(async () => {
		cwd = path.join(os.tmpdir(), `nitpicker-e2e-${crypto.randomUUID()}`);
		await fs.mkdir(cwd, { recursive: true });
		const baseline = await CrawlerOrchestrator.crawling(
			[`${TEST_SERVER_ORIGIN}/trap/date/`],
			{ cwd, interval: 0, parallels: 1, image: false, dedupeCap: 3 },
		);
		filePath = baseline.archive.filePath;
		await baseline.write();
		await baseline.archive.close();
		baseline.garbageCollect();

		const capped = await Archive.open({ filePath, cwd });
		const { total, items } = await listDedupeCapEvents(capped);
		expect(total).toBe(1);
		expect(items[0]?.shape_key).toContain('/trap/date/{n}/');

		// Inject two synthetic failed pages directly — same technique
		// `retry-failed.e2e.ts`'s permanent-kind-exclusion test uses to pin
		// a failure signal without depending on a real, hermetically
		// awkward-to-trigger failure. One shares the just-confirmed trap
		// shape; one is an unrelated shape, as a control proving the
		// exclusion is scoped to the matching shape, not a blanket
		// "nothing gets reset" bug.
		const knex = capped.getKnex();
		/**
		 * Inserts a bare `content_items` row recording a scraped, failed
		 * (status 500) page — no `page_meta` row, since `resetFailedPages`'s
		 * candidate scan only joins `content_items`/`url_refs`. A real
		 * `content_type_refs` row + `content_type_id` IS required though:
		 * `getPages('page')` (used by this test's own assertions) filters on
		 * `ctr.raw = 'text/html'`, and a real crawl's error page always has a
		 * content type (the fixture serves its 500 responses as HTML).
		 * @param url - The synthetic page's URL.
		 */
		async function insertFailedStub(url: string): Promise<void> {
			const [urlRef] = await knex('url_refs').insert({ url }).returning('id');
			const [ctRef] = await knex('content_type_refs')
				.insert({ raw: 'text/html', normalized: 'text/html', category: 'other' })
				.onConflict('raw')
				.merge({ raw: 'text/html' })
				.returning('id');
			await knex('content_items').insert({
				url_id: urlRef.id,
				is_external: 0,
				scraped: 1,
				is_target: 1,
				status: 500,
				status_text: 'Internal Server Error',
				content_type_id: ctRef.id,
			});
		}
		await insertFailedStub(`${TEST_SERVER_ORIGIN}/trap/date/9999/`);
		await insertFailedStub(`${TEST_SERVER_ORIGIN}/unrelated-fail-page`);
		await capped.write();
		await capped.close();

		const retry = await CrawlerOrchestrator.retryFailed(filePath, { cwd });
		await retry.write();
		await retry.archive.close();
		retry.garbageCollect();

		accessor = await Archive.open({ filePath, cwd });
	}, 240_000);

	afterAll(async () => {
		await accessor?.close();
		await fs.rm(cwd, { recursive: true, force: true });
	});

	/**
	 * Reads a `content_items` row's `scraped`/`status` back by URL, directly
	 * via knex — not `accessor.getPages('page')`, which filters on
	 * `content_type_refs.raw = 'text/html'` and would therefore miss a row
	 * `resetFailedPages` reset (clearing `content_type_id` to `NULL`) and
	 * that this fixture never re-crawls (no `anchor_edges` referrer — see
	 * the "unrelated" test below).
	 * @param url - The page's URL.
	 * @returns The row's `scraped`/`status`, or `undefined` if no row matches.
	 */
	async function getRawPageState(
		url: string,
	): Promise<{ scraped: number; status: number | null } | undefined> {
		const knex = accessor.getKnex();
		return (await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.scraped as scraped', 'ci.status as status')
			.where('ur.url', url)
			.first()) as { scraped: number; status: number | null } | undefined;
	}

	it('確定済みtrap shapeに属する失敗ページはretry-failed後もstatus=500のまま据え置かれる', async () => {
		const trapStub = await getRawPageState(`${TEST_SERVER_ORIGIN}/trap/date/9999/`);
		expect(trapStub).toBeDefined();
		expect(trapStub!.scraped).toBe(1);
		expect(trapStub!.status).toBe(500);
	});

	it('無関係shapeの失敗ページは通常どおりresetされる（除外がshape単位であることの対照実験）', async () => {
		// This synthetic row has no `anchor_edges` referrer (a real crawl's
		// failed page always does; only this direct-insert fixture doesn't),
		// so `getCrawlingState`'s strict pending set never picks it up for
		// an actual re-fetch — it is reset and stays `scraped=0` rather than
		// being re-crawled to a new terminal status. That is still the
		// structural proof this test needs: `resetFailedPages` did NOT
		// leave it at `scraped=1, status=500` the way it left the
		// trap-shaped stub above, so the exclusion is scoped to the
		// matching shape, not a blanket "nothing gets reset" bug.
		const unrelated = await getRawPageState(`${TEST_SERVER_ORIGIN}/unrelated-fail-page`);
		expect(unrelated).toBeDefined();
		expect(unrelated!.scraped).toBe(0);
		expect(unrelated!.status).toBeNull();
	});
});
