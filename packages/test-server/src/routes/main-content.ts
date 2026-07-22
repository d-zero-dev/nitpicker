import type { Hono } from 'hono';

/**
 * Registers `/main-content/` — a page with a `<main>` element containing one
 * of each element type beholder's main-content extraction recognizes
 * (headings, image, table, button, iframe, video, audio, canvas). Used to
 * exercise the real DOM-heuristic detection path (as opposed to a hand-built
 * `mainContents` fixture object) end to end through an actual headless-browser
 * crawl.
 * @param app - The Hono application instance to register routes on.
 */
export function mainContentRoutes(app: Hono) {
	app.get('/main-content/', (c) =>
		c.html(
			`<!doctype html><html lang="en"><head><title>Main Content Page</title></head><body>
<header><h1>Site Header</h1></header>
<main id="content" class="l-main">
<h1>Main Heading</h1>
<h2>Sub Heading</h2>
<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=" alt="main image">
<table>
<thead><tr><th>A</th><th>B</th></tr></thead>
<tbody><tr><td colspan="2">merged</td></tr></tbody>
<tfoot><tr><td>F</td><td>F</td></tr></tfoot>
</table>
<button type="button">Click me</button>
<iframe src="/about" title="embedded about page" width="300" height="200"></iframe>
<video src="/media/sample.mp4" poster="/media/poster.jpg" width="640" height="360"></video>
<audio src="/media/sample.mp3"></audio>
<canvas width="300" height="150"></canvas>
</main>
<footer><a href="/about">About</a></footer>
</body></html>`,
		),
	);
}
