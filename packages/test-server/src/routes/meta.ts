import type { PortRef } from '../server.js';
import type { Hono } from 'hono';

/**
 * Registers routes for testing HTML meta tag extraction across the v2
 * schema's flat columns + meta_extras catch-all + page_jsonld + page_tags
 * coverage. Each route renders a deterministic HTML snippet — the e2e
 * tests in `meta.e2e.ts` assert against these exact strings.
 * @param app - The Hono application instance to register routes on.
 * @param portRef - Holder for the server's actual listening port, used to
 *   build the absolute self-referencing URLs embedded in `/meta/full` below.
 */
export function metaRoutes(app: Hono, portRef: PortRef) {
	app.get('/meta/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Meta Top</title></head><body>' +
				'<a href="/meta/full">Full</a>' +
				'<a href="/meta/robots-noindex">Noindex</a>' +
				'<a href="/meta/minimal">Minimal</a>' +
				'<a href="/meta/jsonld">JSON-LD</a>' +
				'<a href="/meta/relative-canonical">Relative canonical</a>' +
				'</body></html>',
		),
	);

	app.get('/meta/full', (c) =>
		c.html(
			'<!doctype html><html lang="ja" dir="ltr">' +
				'<head>' +
				'<meta charset="utf-8">' +
				'<title>Full Meta Page</title>' +
				'<meta name="description" content="Test description">' +
				'<meta name="keywords" content="test,meta,nitpicker">' +
				'<meta name="viewport" content="width=device-width, initial-scale=1">' +
				'<meta name="theme-color" content="#ffffff">' +
				'<meta name="application-name" content="Nitpicker Test">' +
				'<meta name="author" content="Yusuke Hirao">' +
				'<meta name="generator" content="hono-test-server">' +
				'<meta name="publisher" content="D-Zero">' +
				'<meta name="robots" content="index,follow,max-image-preview:large">' +
				'<meta name="googlebot" content="index,follow">' +
				'<meta name="google-site-verification" content="google-token-abc">' +
				'<meta name="format-detection" content="telephone=no">' +
				'<meta property="fb:app_id" content="123456789">' +
				`<link rel="canonical" href="http://localhost:${portRef.port}/meta/full">` +
				`<link rel="alternate" hreflang="en" href="http://localhost:${portRef.port}/meta/full-en">` +
				'<link rel="manifest" href="/manifest.webmanifest">' +
				'<link rel="icon" href="/favicon.ico">' +
				'<link rel="apple-touch-icon" href="/apple-touch-icon.png">' +
				`<link rel="amphtml" href="http://localhost:${portRef.port}/meta/full.amp">` +
				'<meta property="og:type" content="article">' +
				'<meta property="og:title" content="OG Title">' +
				'<meta property="og:site_name" content="Test Site">' +
				'<meta property="og:description" content="OG Description">' +
				`<meta property="og:url" content="http://localhost:${portRef.port}/meta/full">` +
				`<meta property="og:image" content="http://localhost:${portRef.port}/og-image.png">` +
				'<meta property="og:image:alt" content="OG image alt">' +
				'<meta property="og:image:width" content="1200">' +
				'<meta property="og:image:height" content="630">' +
				'<meta property="og:locale" content="ja_JP">' +
				'<meta property="article:published_time" content="2026-01-01T00:00:00Z">' +
				'<meta property="article:modified_time" content="2026-02-01T00:00:00Z">' +
				'<meta name="twitter:card" content="summary_large_image">' +
				'<meta name="twitter:site" content="@example">' +
				'<meta name="twitter:creator" content="@yusuke">' +
				'<meta name="twitter:title" content="Twitter Title">' +
				'<meta name="twitter:description" content="Twitter Desc">' +
				`<meta name="twitter:image" content="http://localhost:${portRef.port}/twitter-image.png">` +
				'<meta name="DC.title" content="Dublin Core Title">' +
				'<meta name="geo.region" content="JP-13">' +
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
				'<meta name="robots" content="noindex,nofollow,noarchive,noimageindex">' +
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

	app.get('/meta/jsonld', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head>' +
				'<title>JSON-LD Sample</title>' +
				'<script type="application/ld+json">' +
				JSON.stringify({
					'@context': 'https://schema.org',
					'@type': 'Product',
					name: 'Example Product',
					sku: 'X-100',
				}) +
				'</script>' +
				'<script type="application/ld+json">' +
				JSON.stringify({
					'@context': 'https://schema.org',
					'@type': 'BreadcrumbList',
					itemListElement: [],
				}) +
				'</script>' +
				'</head><body><p>JSON-LD content</p></body></html>',
		),
	);

	// Page with a *relative* canonical href so the absolutisation behaviour of
	// deriveFlatFromMeta can be asserted against the live crawler.
	app.get('/meta/relative-canonical', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head>' +
				'<title>Relative canonical</title>' +
				'<link rel="canonical" href="/meta/relative-canonical">' +
				'</head><body><p>Relative canonical body.</p></body></html>',
		),
	);
}
