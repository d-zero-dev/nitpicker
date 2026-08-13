import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { collectCustomElements } from './collect-custom-elements.js';

const FIXTURE_HTML = `<!doctype html>
<html>
	<body>
		<header><my-header-widget id="hdr" class="chrome"></my-header-widget></header>
		<main id="content">
			<section>
				<my-widget id="widget-1" class="foo bar">hello</my-widget>
				<div>plain div, not custom</div>
				<astro-island></astro-island>
			</section>
			<svg><font-face-name></font-face-name></svg>
		</main>
	</body>
</html>`;

describe('collectCustomElements', () => {
	it('collects custom elements inside the main-content region in document order', () => {
		const dom = new JSDOM(FIXTURE_HTML);
		const candidates = collectCustomElements(null, dom.window.document);
		expect(candidates).toEqual([
			{ nodeName: 'MY-WIDGET', elementId: 'widget-1', classList: ['foo', 'bar'] },
			{ nodeName: 'ASTRO-ISLAND', elementId: null, classList: [] },
		]);
	});

	it('does not collect custom elements outside the main-content region', () => {
		const dom = new JSDOM(FIXTURE_HTML);
		const candidates = collectCustomElements(null, dom.window.document);
		expect(candidates.some((c) => c.nodeName === 'MY-HEADER-WIDGET')).toBe(false);
	});

	it('skips native (non-hyphenated) HTML tags', () => {
		const dom = new JSDOM(FIXTURE_HTML);
		const candidates = collectCustomElements(null, dom.window.document);
		expect(candidates.some((c) => c.nodeName === 'DIV')).toBe(false);
	});

	it('skips the Custom Elements spec reserved hyphenated SVG/MathML names', () => {
		const dom = new JSDOM(FIXTURE_HTML);
		const candidates = collectCustomElements(null, dom.window.document);
		expect(candidates.some((c) => c.nodeName === 'FONT-FACE-NAME')).toBe(false);
	});

	it('returns an empty array when the page has no custom elements', () => {
		const dom = new JSDOM(
			'<!doctype html><html><body><main><p>text</p></main></body></html>',
		);
		expect(collectCustomElements(null, dom.window.document)).toEqual([]);
	});

	it('returns an empty array when no main-content region can be resolved', () => {
		const dom = new JSDOM(
			'<!doctype html><html><body><div><my-widget></my-widget></div></body></html>',
		);
		expect(collectCustomElements(null, dom.window.document)).toEqual([]);
	});

	it('resolves the main-content region via role="main" fallback like beholder does', () => {
		const dom = new JSDOM(
			'<!doctype html><html><body><div role="main"><my-widget id="w"></my-widget></div></body></html>',
		);
		const candidates = collectCustomElements(null, dom.window.document);
		expect(candidates).toEqual([
			{ nodeName: 'MY-WIDGET', elementId: 'w', classList: [] },
		]);
	});

	it('resolves the main-content region via a caller-supplied selector', () => {
		const dom = new JSDOM(
			'<!doctype html><html><body><div id="page-body"><my-widget id="w"></my-widget></div></body></html>',
		);
		const candidates = collectCustomElements('#page-body', dom.window.document);
		expect(candidates).toEqual([
			{ nodeName: 'MY-WIDGET', elementId: 'w', classList: [] },
		]);
	});
});
