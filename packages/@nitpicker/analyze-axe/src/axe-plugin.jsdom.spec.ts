import { JSDOM } from 'jsdom';
import { describe, it, expect } from 'vitest';

import createAxePlugin from './axe-plugin.js';

/**
 * Regression coverage for the "closed window" bug: axe-core's UMD bundle
 * binds `window`/`document` into a closure at module-evaluation time, so a
 * single top-level `import('axe-core')` reused across pages in a long-lived
 * worker would keep using the *first* page's window forever. Once that
 * window is closed (as `page-analysis-worker.ts` does after every page),
 * axe-core's result builder crashes reading `window.location.href` on the
 * closed window, surfacing as
 * `Cannot read properties of null (reading '_location')`.
 *
 * Unlike `axe-plugin.spec.ts` (which mocks `axe-core` entirely), this file
 * exercises the real `axe-core` package against real JSDOM windows so the
 * window-binding behavior described above is actually covered.
 */
describe('analyze-axe plugin (real axe-core + real JSDOM)', () => {
	it('reports violations for a second page after the first page’s window is closed', async () => {
		const plugin = await createAxePlugin({}, '');

		const htmlA = '<html><body><img src="a.png"></body></html>';
		const domA = new JSDOM(htmlA, {
			url: 'https://example.com/a',
			runScripts: 'outside-only',
		});
		const resultA = await plugin.eachPage!({
			url: new URL('https://example.com/a'),
			html: htmlA,
			window: domA.window,
			num: 0,
			total: 2,
		});
		domA.window.close();

		const htmlB = '<html><body><img src="b.png"></body></html>';
		const domB = new JSDOM(htmlB, {
			url: 'https://example.com/b',
			runScripts: 'outside-only',
		});
		const resultB = await plugin.eachPage!({
			url: new URL('https://example.com/b'),
			html: htmlB,
			window: domB.window,
			num: 1,
			total: 2,
		});
		domB.window.close();

		// Neither page should surface the closed-window crash as an
		// `error`-severity violation.
		for (const result of [resultA, resultB]) {
			const crashed = result!.violations.some(
				(v) => v.severity === 'error' && v.message.includes('_location'),
			);
			expect(crashed).toBe(false);
		}

		// Both pages must be evaluated against their own, still-open window:
		// each independently reports the `image-alt` violation for its own
		// `<img>` element.
		expect(resultA!.violations.some((v) => v.rule === 'image-alt')).toBe(true);
		expect(resultB!.violations.some((v) => v.rule === 'image-alt')).toBe(true);
	});

	it('does not rely on globalThis exposing the page window', async () => {
		const plugin = await createAxePlugin({}, '');
		const html = '<html><body><img src="a.png"></body></html>';
		const dom = new JSDOM(html, {
			url: 'https://example.com',
			runScripts: 'outside-only',
		});

		// Deliberately do not copy any JSDOM property onto globalThis.
		const result = await plugin.eachPage!({
			url: new URL('https://example.com'),
			html,
			window: dom.window,
			num: 0,
			total: 1,
		});
		dom.window.close();

		expect(result!.violations.some((v) => v.rule === 'image-alt')).toBe(true);
	});
});
