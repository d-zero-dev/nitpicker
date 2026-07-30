import { listDedupeCapEvents } from '@nitpicker/query';
import { afterAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';
import { TEST_SERVER_PORT } from './test-server-port.js';

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
