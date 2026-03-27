import type { Hono } from 'hono';

/**
 * Registers routes that simulate scroll-jacking / viewport-dependent redirect.
 *
 * The `/scroll-jack/` page contains a JavaScript redirect that fires when the
 * viewport width is below 500px. This reproduces the "Execution context was
 * destroyed" error that occurs during image extraction on pages using
 * fullpage.js or similar viewport-sensitive libraries.
 * @param app - The Hono application instance to register routes on.
 */
export function scrollJackRoutes(app: Hono) {
	app.get('/scroll-jack/', (c) =>
		c.html(
			`<!doctype html><html lang="en"><head><title>Scroll Jack Page</title>
<script>
// Simulate viewport-dependent delayed redirect (e.g. fullpage.js scroll-jacking
// that triggers navigation during scroll). The 200ms delay ensures the redirect
// fires after beforePageScan's navigateWithFallback completes, destroying the
// execution context during scrollAllOver or image extraction.
if (window.innerWidth < 500) {
	setTimeout(function() { window.location.href = '/scroll-jack/mobile/'; }, 200);
}
</script>
</head><body>
<h1>Scroll Jack Page</h1>
<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=" alt="desktop image" width="100" height="100">
</body></html>`,
		),
	);

	app.get('/scroll-jack/mobile/', (c) =>
		c.html(
			'<!doctype html><html lang="en"><head><title>Mobile Redirect</title></head><body><p>Redirected to mobile</p></body></html>',
		),
	);
}
