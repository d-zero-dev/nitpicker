import type { PortRef } from '../server.js';
import type { Hono } from 'hono';

/**
 * Whether `/trap/replay/203/` is currently healed (serves 200, same trap
 * signature as its siblings) or failing (500). Module-level, like
 * `flaky.ts`'s `healed` flag, so an E2E test can flip it over HTTP between
 * sessions independent of process boundaries — see
 * `dedupeCapTrapRoutes`'s `/trap/replay/` doc for why this member exists.
 */
let replayMemberHealed = false;

/**
 * Registers routes reproducing the two dedupe-cap trap shapes exercised by
 * `crawler`'s e2e suite (issue #208).
 *
 * Every route links to exactly TWO fixed real anchors (not a large range) —
 * deliberately minimal, since:
 *
 * 1. The `--dedupe-cap` confidence signals (`og:url` mismatch + `body_hash`
 *    match) drop the effective threshold to 1 by the SECOND observation for
 *    every trap shape here, so two real member pages are already enough to
 *    prove the cap fires (see `dedupe-cap.e2e.ts`'s threshold arithmetic in
 *    its own comments).
 * 2. Each page fetch launches a real Puppeteer browser (no cross-page
 *    reuse), so keeping the fixture's page count small matters for e2e
 *    runtime — this is an integration smoke test, not a load test.
 *
 * - `/trap/date/:value/` — a self-generating pager trap. Returns 200 for
 *   ANY `:value` (not just the two fixed anchors), with identical
 *   title/description and an `og:url` that always points at the parent
 *   listing rather than itself — exactly the pattern that caused
 *   nitpicker's own pagination predictor to keep extrapolating past
 *   `Number.MAX_SAFE_INTEGER` into scientific-notation URLs in production.
 * - `/trap/echo/:value/` — same shape, but the `<body>` ECHOES `:value`
 *   into its text. Used to prove the `body_hash` confidence signal in
 *   `DedupeCapTracker` does NOT fire for this variant (every page's body
 *   differs), so the same-cluster cap must rely on the `metaSig`
 *   (title/description/og:*) majority vote alone to still catch it.
 * - `/trap/query/list/?page=:value` — a query-parameter trap, same
 *   title/description/og:url behaviour as `/trap/date/`. `/trap/query/`
 *   itself is only the index page (linking to the query-bearing anchors);
 *   see the query-links comment below for why the trap page itself must
 *   live one path segment deeper.
 * - `/trap/chain/:value/` — a LINEAR self-generating trap: unlike every
 *   other shape above (fixed anchors, bounded), each page here links to
 *   exactly ONE never-before-seen page of the same shape (`n` → `n+1`,
 *   bounded at `CHAIN_DEPTH_LIMIT` (below) purely as a runaway backstop —
 *   see below for why the cap test never actually reaches it). Reproduces
 *   issue #350: `--dedupe-cap`'s enqueue gate (`crawler.ts`'s `addUrl`
 *   closure, "Gate 1") stops a capped shape's anchor from being pushed to
 *   the in-memory dealer queue, but does NOT stop `replaceAnchorEdges`
 *   (`update-page.ts`) from persisting a `scraped=0` row for that same
 *   anchor — the `page` event carries the scraped page's raw, unfiltered
 *   `anchorList`. With this fixture's single-anchor-per-page chain, the
 *   very page whose observation trips the cap (chain/2, the 2nd real
 *   observation — like `/trap/date/`, but `body_hash` never matches here
 *   since each page's `nextLink` embeds a different next value, so only
 *   the `og:url`-mismatch signal halves the threshold, same arithmetic as
 *   `/trap/echo/`) has its own one anchor (chain/3) blocked from the
 *   queue by Gate 1 right after — chain/3 is therefore never scraped and
 *   never will be, yet is written to
 *   `content_items` as a `scraped=0` row referenced by chain/2's
 *   `anchor_edges`. Before `get-crawling-state.ts` learned to exclude
 *   confirmed-capped shapes (issue #350), that row satisfied
 *   `getCrawlingState`'s "has an anchor referrer" filter and stayed in
 *   `pending` forever, since nothing will ever scrape it to clear it —
 *   `CrawlerOrchestrator`'s auto-retry loop kept re-queueing a shape that
 *   can never converge. Exactly ONE anchor per page (never two, unlike
 *   `/trap/date/` etc.) is deliberate: `paginationState` in `crawler.ts`'s
 *   `#handleResult` only compares anchors discovered on the SAME page, so
 *   a single-anchor page never has a second anchor to compare against and
 *   `detectPaginationPattern` can never fire — this fixture needs none of
 *   the "Page-count nuance" workaround the other trap shapes above require.
 * - `/trap/replay/:value/` — a THREE-member trap (907, 501, 203, listed in
 *   DESCENDING order so no adjacent pair is a positive numeric step and
 *   `detectPaginationPattern` never fires, keeping this fixture free of the
 *   "Page-count nuance" this file's other trap shapes have to work around).
 *   No `og:url` tag at all (`ogUrlMismatch` is always `false` for this
 *   shape) so only the `body_hash` confidence signal halves the threshold —
 *   simpler arithmetic for the counter-replay E2E scenario this shape
 *   exists for (see `dedupe-cap.e2e.ts`'s "prior-session counter replay"
 *   describe block). `203` alone is gated by {@link replayMemberHealed}
 *   (500 until healed, the same heal/reset-over-HTTP technique `flaky.ts`
 *   uses) so a test can crawl with `203` failing (only 907/501 observed),
 *   heal it, then run a second session that observes `203` too.
 * @param app - The Hono application instance to register routes on.
 * @param portRef - Holder for the server's actual listening port, used to
 *   build the absolute `og:url` pointing at the parent listing.
 */
export function dedupeCapTrapRoutes(app: Hono, portRef: PortRef) {
	const FIXED_ANCHOR_VALUES = [2020, 2021];

	const dateLinks = FIXED_ANCHOR_VALUES.map(
		(value) => `<a href="/trap/date/${value}/">${value}</a>`,
	).join('');

	app.get('/trap/date/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>News Index</title></head><body>' +
				dateLinks +
				'</body></html>',
		),
	);

	app.get('/trap/date/:value/', (c) => {
		const ogUrl = `http://localhost:${portRef.port}/trap/date/`;
		return c.html(
			'<!doctype html><html lang="en"><head>' +
				'<title>お知らせ</title>' +
				'<meta name="description" content="一覧です">' +
				'<meta property="og:title" content="お知らせ">' +
				`<meta property="og:url" content="${ogUrl}">` +
				'</head><body>' +
				'<p>trap body (identical across every value)</p>' +
				dateLinks +
				'</body></html>',
		);
	});

	const echoLinks = FIXED_ANCHOR_VALUES.map(
		(value) => `<a href="/trap/echo/${value}/">${value}</a>`,
	).join('');

	app.get('/trap/echo/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Echo Index</title></head><body>' +
				echoLinks +
				'</body></html>',
		),
	);

	app.get('/trap/echo/:value/', (c) => {
		const value = c.req.param('value');
		const ogUrl = `http://localhost:${portRef.port}/trap/echo/`;
		return c.html(
			'<!doctype html><html lang="en"><head>' +
				'<title>お知らせ</title>' +
				'<meta name="description" content="一覧です">' +
				'<meta property="og:title" content="お知らせ">' +
				`<meta property="og:url" content="${ogUrl}">` +
				'</head><body>' +
				`<p>Year: ${value}</p>` +
				echoLinks +
				'</body></html>',
		);
	});

	// The query-bearing pages live one path segment DEEPER than this index
	// (`/trap/query/list/?page=N`, not `/trap/query/?page=N`) so that
	// `isLowerLayer` (the crawler's scope check) admits them via path depth
	// alone — two URLs that differ ONLY in their query string, with an
	// otherwise-identical path, are NOT treated as "lower layer" of each
	// other by `@d-zero/shared/is-lower-layer` (confirmed empirically),
	// which would otherwise make every `?page=N` anchor look external
	// relative to a `/trap/query/` root.
	const queryLinks = FIXED_ANCHOR_VALUES.map(
		(value) => `<a href="/trap/query/list/?page=${value}">Page ${value}</a>`,
	).join('');

	app.get('/trap/query/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Query Trap Index</title></head><body>' +
				queryLinks +
				'</body></html>',
		),
	);

	app.get('/trap/query/list/', (c) => {
		const ogUrl = `http://localhost:${portRef.port}/trap/query/`;
		return c.html(
			'<!doctype html><html lang="en"><head>' +
				'<title>一覧</title>' +
				'<meta name="description" content="一覧です">' +
				'<meta property="og:title" content="一覧">' +
				`<meta property="og:url" content="${ogUrl}">` +
				'</head><body>' +
				'<p>query trap body (identical across every value)</p>' +
				queryLinks +
				'</body></html>',
		);
	});

	// Purely a runaway backstop, not load-bearing for the cap test itself:
	// the 2nd observation trips the cap (same arithmetic as `/trap/date/`),
	// so a `--dedupe-cap` crawl of this fixture never gets past chain/2 —
	// this bound only guards a hypothetical crawl of this fixture with
	// dedupe-cap disabled.
	const CHAIN_DEPTH_LIMIT = 6;

	app.get('/trap/chain/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Chain Index</title></head><body>' +
				'<a href="/trap/chain/1/">1</a>' +
				'</body></html>',
		),
	);

	app.get('/trap/chain/:value/', (c) => {
		const value = Number(c.req.param('value'));
		const ogUrl = `http://localhost:${portRef.port}/trap/chain/`;
		const nextLink =
			value < CHAIN_DEPTH_LIMIT
				? `<a href="/trap/chain/${value + 1}/">${value + 1}</a>`
				: '';
		return c.html(
			'<!doctype html><html lang="en"><head>' +
				'<title>お知らせ</title>' +
				'<meta name="description" content="一覧です">' +
				'<meta property="og:title" content="お知らせ">' +
				`<meta property="og:url" content="${ogUrl}">` +
				'</head><body>' +
				// Unlike `/trap/date/`'s and `/trap/query/list/`'s identical
				// paragraph text: this one is fixed, but `nextLink` embeds the
				// NEXT value, so the rendered body as a whole differs page to
				// page — the `body_hash` confidence signal in `DedupeCapTracker`
				// therefore never fires for this shape, same as `/trap/echo/`
				// (see this function's JSDoc `/trap/chain/:value/` entry above).
				'<p>trap body (fixed text, but the link below differs per value)</p>' +
				nextLink +
				'</body></html>',
		);
	});

	app.get('/trap/replay/control/heal', (c) => {
		replayMemberHealed = true;
		return c.text('healed');
	});

	app.get('/trap/replay/control/reset', (c) => {
		replayMemberHealed = false;
		return c.text('reset');
	});

	// Descending order — see this function's JSDoc "why descending" note.
	const REPLAY_ANCHOR_VALUES = [907, 501, 203];
	const replayLinks = REPLAY_ANCHOR_VALUES.map(
		(value) => `<a href="/trap/replay/${value}/">${value}</a>`,
	).join('');

	app.get('/trap/replay/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Replay Trap Index</title></head><body>' +
				replayLinks +
				'</body></html>',
		),
	);

	app.get('/trap/replay/:value/', (c) => {
		const value = c.req.param('value');
		if (value === '203' && !replayMemberHealed) {
			return c.html(
				'<!doctype html><html lang="en"><head><title>Server Error</title></head><body>' +
					'<p>temporary failure</p>' +
					'</body></html>',
				500,
			);
		}
		// No `og:url` tag — see this function's JSDoc: `ogUrlMismatch` stays
		// `false` for every member of this shape, unlike the other three trap
		// variants above.
		return c.html(
			'<!doctype html><html lang="en"><head>' +
				'<title>リプレイお知らせ</title>' +
				'<meta name="description" content="一覧です">' +
				'</head><body>' +
				'<p>trap body (identical across every value)</p>' +
				replayLinks +
				'</body></html>',
		);
	});
}
