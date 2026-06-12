import type { Context, Hono } from 'hono';

/**
 * Registers routes for testing HTTP redirect chains (301 and 302).
 * @param app - The Hono application instance to register routes on.
 */
export function redirectRoutes(app: Hono) {
	app.get('/redirect/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Redirect Top</title></head><body>' +
				'<a href="/redirect/start">Start redirect chain</a>' +
				'</body></html>',
		),
	);

	app.get('/redirect/start', (c) => c.redirect('/redirect/middle', 301));

	app.get('/redirect/middle', (c) => c.redirect('/redirect/dest', 302));

	app.get('/redirect/dest', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Redirect Destination</title></head><body>' +
				'<a href="/redirect/start">Back to start</a>' +
				'</body></html>',
		),
	);

	// Many-to-one redirect convergence: three distinct legacy URLs all 301 to a
	// single canonical destination. Used to verify #73 — the destination is
	// rendered only once and the remaining sources record a redirect edge only.
	app.get('/converge/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Converge Top</title></head><body>' +
				'<a href="/converge/legacy-1">Legacy 1</a>' +
				'<a href="/converge/legacy-2">Legacy 2</a>' +
				'<a href="/converge/legacy-3">Legacy 3</a>' +
				'</body></html>',
		),
	);

	app.get('/converge/legacy-1', (c) => c.redirect('/converge/canonical', 301));
	app.get('/converge/legacy-2', (c) => c.redirect('/converge/canonical', 301));
	app.get('/converge/legacy-3', (c) => c.redirect('/converge/canonical', 301));

	app.get('/converge/canonical', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Converge Canonical</title></head><body>' +
				'<a href="/converge/">Back to top</a>' +
				'</body></html>',
		),
	);

	// Query-distinguished pages that do NOT redirect: two URLs share a path but
	// differ only by query string. The redirect-convergence dedup (#73) must keep
	// them distinct (the dedup key must not collapse them), so both are rendered.
	// Non-numeric query values are used so the predicted-pagination heuristic does
	// not speculatively fetch extra pages and muddy the assertion.
	app.get('/query-distinct/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Q Top</title></head><body>' +
				'<a href="/query-distinct/item?kind=alpha">Item alpha</a>' +
				'<a href="/query-distinct/item?kind=beta">Item beta</a>' +
				'</body></html>',
		),
	);

	app.get('/query-distinct/item', (c) => {
		const kind = c.req.query('kind') ?? 'none';
		return c.html(
			`<!doctype html><html lang="en"><head><title>Item ${kind}</title></head><body>` +
				`<p>item ${kind}</p>` +
				'</body></html>',
		);
	});

	// HEAD and GET resolve to DIFFERENT destinations: the HEAD pre-flight lands on
	// /diverge/head-dest, but the browser (GET) follows to /diverge/browser-dest.
	// The redirect-dedup must claim the destination the browser actually rendered
	// (#73), not the HEAD guess — otherwise a sibling source is short-circuited to
	// an edge pointing at the never-rendered /diverge/head-dest phantom row.
	app.get('/diverge/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Diverge Top</title></head><body>' +
				'<a href="/diverge/src1">Source 1</a>' +
				'<a href="/diverge/src2">Source 2</a>' +
				'</body></html>',
		),
	);

	const divergeSource = (c: Context) =>
		c.redirect(
			c.req.method === 'HEAD' ? '/diverge/head-dest' : '/diverge/browser-dest',
			301,
		);
	app.on(['GET', 'HEAD'], '/diverge/src1', divergeSource);
	app.on(['GET', 'HEAD'], '/diverge/src2', divergeSource);

	app.get('/diverge/head-dest', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Diverge HEAD dest</title></head><body>' +
				'<p>head dest</p></body></html>',
		),
	);
	app.get('/diverge/browser-dest', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Diverge Browser dest</title></head><body>' +
				'<p>browser dest</p></body></html>',
		),
	);

	// A metadata-only (external) redirect source must NOT overwrite an
	// already-rendered internal destination with its thin title-GET result (#73).
	// The external link is placed ON the canonical page itself, so the canonical is
	// always rendered (and claimed) before the external source is discovered — the
	// destination is never re-rendered afterwards, so a clobber would be permanent.
	// `127.0.0.1` is treated as a different host (external scope); it 301s back to
	// the internal `localhost` canonical.
	app.get('/clobber/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Clobber Top</title></head><body>' +
				'<a href="/clobber/canonical">Canonical</a>' +
				'</body></html>',
		),
	);

	app.get('/clobber/canonical', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Clobber Canonical</title></head><body>' +
				'<a href="http://127.0.0.1:8010/clobber/ext">External tracker link</a>' +
				'</body></html>',
		),
	);

	app.on(['GET', 'HEAD'], '/clobber/ext', (c) =>
		c.redirect('http://localhost:8010/clobber/canonical', 301),
	);
}
