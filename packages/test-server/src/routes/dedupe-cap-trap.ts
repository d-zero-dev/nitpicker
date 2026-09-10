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
