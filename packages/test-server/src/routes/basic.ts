import type { Hono } from 'hono';

/**
 *
 * @param app
 */
export function basicRoutes(app: Hono) {
	app.get('/', (c) =>
		c.html(
			`<!doctype html><html lang="en"><head><title>Test Top</title></head><body>
<a href="/about">About</a>
<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=" alt="test image" width="100" height="100">
<div style="height:800px"></div>
<img src="data:image/svg+xml;charset=utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='150'><rect fill='red' width='200' height='150'/></svg>" alt="lazy image" width="200" height="150" loading="lazy">
</body></html>`,
		),
	);

	app.get('/about', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>About</title></head><body><a href="/">Home</a></body></html>',
		),
	);
}
