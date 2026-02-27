import type { Hono } from 'hono';

/**
 *
 * @param app
 */
export function metaRoutes(app: Hono) {
	app.get('/meta/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Meta Top</title></head><body>' +
				'<a href="/meta/full">Full</a>' +
				'<a href="/meta/robots-noindex">Noindex</a>' +
				'<a href="/meta/minimal">Minimal</a>' +
				'</body></html>',
		),
	);

	app.get('/meta/full', (c) =>
		c.html(
			'<!doctype html><html lang="ja">' +
				'<head>' +
				'<title>Full Meta Page</title>' +
				'<meta name="description" content="Test description">' +
				'<meta name="keywords" content="test,meta,nitpicker">' +
				'<meta name="robots" content="index,follow">' +
				'<link rel="canonical" href="http://localhost:8010/meta/full">' +
				'<link rel="alternate" href="http://localhost:8010/meta/full-en">' +
				'<meta property="og:type" content="website">' +
				'<meta property="og:title" content="OG Title">' +
				'<meta property="og:site_name" content="Test Site">' +
				'<meta property="og:description" content="OG Description">' +
				'<meta property="og:url" content="http://localhost:8010/meta/full">' +
				'<meta property="og:image" content="http://localhost:8010/og-image.png">' +
				'<meta name="twitter:card" content="summary_large_image">' +
				'</head>' +
				'<body>' +
				'<a href="/meta/robots-noindex">Noindex</a>' +
				'<a href="/meta/minimal">Minimal</a>' +
				'</body></html>',
		),
	);

	app.get('/meta/robots-noindex', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head>' +
				'<title>Robots Noindex</title>' +
				'<meta name="robots" content="noindex,nofollow,noarchive">' +
				'</head><body><p>This page should not be indexed.</p></body></html>',
		),
	);

	app.get('/meta/minimal', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head>' +
				'<title>Minimal Page</title>' +
				'</head><body><p>Minimal meta tags.</p></body></html>',
		),
	);
}
