import { describe, it, expect, vi } from 'vitest';

import { createDomPathResolver } from './create-dom-path-resolver.mjs';

describe('createDomPathResolver', () => {
	it('falls back to unknown/<id> for every image when htmlString is null', async () => {
		const resolve = createDomPathResolver();
		const result = await resolve(1, null, [
			{ id: 10, sourceCode: '<img src="a.png">' },
			{ id: 11, sourceCode: '<img src="b.png">' },
		]);
		expect(result.get(10)).toEqual({ path: 'unknown/10', case: 'unknown' });
		expect(result.get(11)).toEqual({ path: 'unknown/11', case: 'unknown' });
	});

	it('single-matches one <img> to its dom_path', async () => {
		const resolve = createDomPathResolver();
		const html =
			'<!doctype html><html><body><main><img src="a.png"></main></body></html>';
		const result = await resolve(1, html, [{ id: 10, sourceCode: '<img src="a.png">' }]);
		expect(result.get(10)).toEqual({
			path: 'html/body[1]/main[1]/img[1]',
			case: 'single-match',
		});
	});

	it('ordinal-matches identical <img> tags in id order', async () => {
		const resolve = createDomPathResolver();
		const html =
			'<!doctype html><html><body><img src="a.png"><img src="a.png"></body></html>';
		const result = await resolve(1, html, [
			{ id: 10, sourceCode: '<img src="a.png">' },
			{ id: 11, sourceCode: '<img src="a.png">' },
		]);
		expect(result.get(10)).toEqual({
			path: 'html/body[1]/img[1]',
			case: 'ordinal-match',
		});
		expect(result.get(11)).toEqual({
			path: 'html/body[1]/img[2]',
			case: 'ordinal-match',
		});
	});

	it('falls back to unknown/<id> when sourceCode has no DOM match', async () => {
		const resolve = createDomPathResolver();
		const html = '<!doctype html><html><body><img src="a.png"></body></html>';
		const result = await resolve(1, html, [
			{ id: 10, sourceCode: '<img src="gone.png">' },
		]);
		expect(result.get(10)).toEqual({ path: 'unknown/10', case: 'unknown' });
	});

	it('warns once per unknown fallback, naming the page and image id', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const resolve = createDomPathResolver();
		await resolve(42, null, [{ id: 10, sourceCode: '<img src="a.png">' }]);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('image id=10 (page 42): no HTML snapshot stored'),
		);
		warn.mockRestore();
	});
});
