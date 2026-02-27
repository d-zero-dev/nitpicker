import type { Hono } from 'hono';

/**
 *
 * @param app
 */
export function scopeRoutes(app: Hono) {
	app.get('/scope/blog/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Blog Top</title></head><body>' +
				'<a href="/scope/blog/post-1">Post 1</a>' +
				'<a href="/scope/blog/post-2">Post 2</a>' +
				'<a href="/scope/docs/">Docs</a>' +
				'</body></html>',
		),
	);

	app.get('/scope/blog/post-1', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Post 1</title></head><body>' +
				'<p>Blog post 1</p>' +
				'</body></html>',
		),
	);

	app.get('/scope/blog/post-2', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Post 2</title></head><body>' +
				'<p>Blog post 2</p>' +
				'</body></html>',
		),
	);

	app.get('/scope/docs/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Docs Top</title></head><body>' +
				'<a href="/scope/docs/api">API Docs</a>' +
				'</body></html>',
		),
	);

	app.get('/scope/docs/api', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>API Docs</title></head><body>' +
				'<p>API documentation</p>' +
				'</body></html>',
		),
	);

	app.get('/scope/admin/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Admin</title></head><body>' +
				'<a href="/scope/admin/settings">Settings</a>' +
				'</body></html>',
		),
	);

	app.get('/scope/admin/settings', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Settings</title></head><body>' +
				'<p>Admin settings</p>' +
				'</body></html>',
		),
	);
}
