import type { Hono } from 'hono';

/**
 * Registers "inventory fixture" routes — pages and files that exist on the
 * server but no crawl-visible page links to. The `crawl --inventory`
 * feature is built to surface these:
 *
 * - `/inventory/hidden-lp` — an HTML landing page no anchor points at.
 *   Used by the orchestrator E2E to verify `'inventory-seed'` labelling.
 * - `/inventory/inner-link` — linked only from `/inventory/hidden-lp`,
 *   so it surfaces ONLY when the hidden LP is rendered as a seed and the
 *   recursive crawl follows the link. Used to verify
 *   `'inventory-discovered'` labelling.
 * - `/inventory/orphan.pdf` — a non-HTML asset no page references. Used
 *   to verify that HEAD-only inventory inserts surface as
 *   `'inventory-seed'` in `resources`.
 * @param app - The Hono application instance to register routes on.
 */
export function inventoryRoutes(app: Hono) {
	app.get('/inventory/hidden-lp', (c) =>
		c.html(
			`<!doctype html><html lang="en"><head><title>Hidden LP</title></head><body>
<a href="/inventory/inner-link">Inner link</a>
</body></html>`,
		),
	);

	app.get('/inventory/inner-link', (c) =>
		c.html(
			`<!doctype html><html lang="en"><head><title>Inner Link Page</title></head><body>
<p>Discovered via the hidden LP.</p>
</body></html>`,
		),
	);

	app.get('/inventory/orphan.pdf', (c) => {
		c.header('Content-Type', 'application/pdf');
		return c.body('%PDF-1.4 stub body for tests');
	});
}
