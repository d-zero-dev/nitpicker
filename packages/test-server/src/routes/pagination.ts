import type { Hono } from 'hono';

const MAX_PAGE = 10;

/**
 * @param app
 */
export function paginationRoutes(app: Hono) {
	// Index page: /pagination/ → link to /pagination/page/1
	app.get('/pagination/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Pagination Index</title></head><body>' +
				'<a href="/pagination/page/1">Page 1</a>' +
				'</body></html>',
		),
	);

	// Path-based pagination: /pagination/page/1 → /pagination/page/2 → ... → /pagination/page/10
	app.get('/pagination/page/:num', (c) => {
		const num = Number.parseInt(c.req.param('num'), 10);
		if (Number.isNaN(num) || num < 1 || num > MAX_PAGE) {
			return c.notFound();
		}
		const nextLink =
			num < MAX_PAGE ? `<a href="/pagination/page/${num + 1}">Next</a>` : '';
		return c.html(
			`<!doctype html><html lang="en"><head><title>Page ${num}</title></head><body>` +
				`<p>Page ${num}</p>` +
				nextLink +
				'</body></html>',
		);
	});
}
