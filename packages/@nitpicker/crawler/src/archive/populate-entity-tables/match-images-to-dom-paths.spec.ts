import { JSDOM } from 'jsdom';
import { describe, it, expect } from 'vitest';

import { matchImagesToDomPaths } from './match-images-to-dom-paths.js';

/**
 * Parses `html`, returns the `<img>` list in document order for use with
 * `matchImagesToDomPaths`.
 * @param html - Fixture HTML.
 */
function imgs(html: string): Element[] {
	const dom = new JSDOM(html);
	return [...dom.window.document.querySelectorAll('img')];
}

describe('matchImagesToDomPaths (dom-path-derivation, all 3 cases)', () => {
	it('single-match: assigns the unique DOM path for exact outerHTML match', () => {
		const elements = imgs(
			'<!doctype html><html><body><main><img src="a.png"></main></body></html>',
		);
		const result = matchImagesToDomPaths(
			[{ id: 42, sourceCode: '<img src="a.png">' }],
			elements,
		);
		expect(result.get(42)).toEqual({
			path: 'html/body[1]/main[1]/img[1]',
			case: 'single-match',
		});
	});

	it('ordinal-match: assigns identical-outerHTML matches in images.id order', () => {
		// Two identical `<img>` tags on the same page — differentiated only
		// by their DOM position. `images.id` ordering (10 then 20)
		// corresponds to document order (first `<img>` then second).
		const elements = imgs(
			'<!doctype html><html><body><main><img src="dup.png"><img src="dup.png"></main></body></html>',
		);
		const result = matchImagesToDomPaths(
			[
				{ id: 10, sourceCode: '<img src="dup.png">' },
				{ id: 20, sourceCode: '<img src="dup.png">' },
			],
			elements,
		);
		expect(result.get(10)).toEqual({
			path: 'html/body[1]/main[1]/img[1]',
			case: 'ordinal-match',
		});
		expect(result.get(20)).toEqual({
			path: 'html/body[1]/main[1]/img[2]',
			case: 'ordinal-match',
		});
	});

	it('unknown: falls back to synthetic path when sourceCode is null', () => {
		const elements = imgs('<!doctype html><html><body><img src="a.png"></body></html>');
		const result = matchImagesToDomPaths([{ id: 7, sourceCode: null }], elements);
		expect(result.get(7)).toEqual({ path: 'unknown/7', case: 'unknown' });
	});

	it('unknown: falls back when no DOM element matches the outerHTML', () => {
		const elements = imgs('<!doctype html><html><body><img src="a.png"></body></html>');
		const result = matchImagesToDomPaths(
			[{ id: 99, sourceCode: '<img src="never-in-dom.png">' }],
			elements,
		);
		expect(result.get(99)).toEqual({ path: 'unknown/99', case: 'unknown' });
	});

	it('unknown: falls back when the archived HTML has zero <img> elements', () => {
		const elements = imgs('<!doctype html><html><body></body></html>');
		const result = matchImagesToDomPaths(
			[{ id: 1, sourceCode: '<img src="x.png">' }],
			elements,
		);
		expect(result.get(1)).toEqual({ path: 'unknown/1', case: 'unknown' });
	});

	it('falls back to unknown when more images share sourceCode than DOM candidates', () => {
		// Regression guard: reusing the last candidate (`candidates.at(-1)`)
		// would silently map every overflow row to the same last DOM
		// element. Overflow rows must each keep a unique `unknown/<id>`
		// marker so they stay distinguishable in the archive.
		const elements = imgs(
			'<!doctype html><html><body><img src="dup.png"><img src="dup.png"></body></html>',
		);
		const result = matchImagesToDomPaths(
			[
				{ id: 10, sourceCode: '<img src="dup.png">' },
				{ id: 20, sourceCode: '<img src="dup.png">' },
				{ id: 30, sourceCode: '<img src="dup.png">' },
			],
			elements,
		);
		expect(result.get(10)?.case).toBe('ordinal-match');
		expect(result.get(20)?.case).toBe('ordinal-match');
		expect(result.get(30)).toEqual({ path: 'unknown/30', case: 'unknown' });
	});

	it('handles mixed single-match / ordinal-match / unknown in one call', () => {
		const elements = imgs(
			'<!doctype html><html><body><img src="uniq.png"><img src="dup.png"><img src="dup.png"></body></html>',
		);
		const result = matchImagesToDomPaths(
			[
				{ id: 1, sourceCode: '<img src="uniq.png">' },
				{ id: 2, sourceCode: '<img src="dup.png">' },
				{ id: 3, sourceCode: '<img src="dup.png">' },
				{ id: 4, sourceCode: null },
				{ id: 5, sourceCode: '<img src="never.png">' },
			],
			elements,
		);
		expect(result.get(1)?.case).toBe('single-match');
		expect(result.get(2)?.case).toBe('ordinal-match');
		expect(result.get(3)?.case).toBe('ordinal-match');
		expect(result.get(4)?.case).toBe('unknown');
		expect(result.get(5)?.case).toBe('unknown');
	});
});
