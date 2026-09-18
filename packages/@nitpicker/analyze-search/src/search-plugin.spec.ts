import type createSearchPlugin from './search-plugin.js';

import { JSDOM } from 'jsdom';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

let pluginFactory: typeof createSearchPlugin;
const pluginModulePromise = import('./search-plugin.js');

beforeAll(async () => {
	const pluginModule = await pluginModulePromise;
	pluginFactory = pluginModule.default;
}, 30_000);

beforeEach(() => {
	vi.clearAllMocks();
});

/**
 * Creates a JSDOM window from an HTML string.
 *
 * Deliberately does not touch `globalThis`: `eachPage` runs inside a Worker
 * thread (see `page-analysis-worker.ts`) with no DOM globals exposed there,
 * so `recursiveSearch` must work using only the `window` argument it
 * receives, not a global `Node` constructor.
 * @param html - HTML to parse.
 * @returns The JSDOM window.
 */
function createWindow(html: string) {
	const dom = new JSDOM(html, { url: 'https://example.com' });
	return dom.window;
}

describe('analyze-search plugin', () => {
	it('does not depend on globalThis exposing a Node constructor', () => {
		const g = globalThis as Record<string, unknown>;
		expect('Node' in g).toBe(false);

		const window = createWindow('<html><body><p>Hello World</p></body></html>');
		const plugin = pluginFactory({ keywords: ['Hello'] }, '');
		const result = plugin.eachPage!({
			url: new URL('https://example.com'),
			html: '',
			window: window as never,
			num: 0,
			total: 1,
		});

		expect(result).toMatchObject({
			page: {
				'keyword:Hello': { value: 1 },
			},
		});
	});

	it('returns label', () => {
		const plugin = pluginFactory({}, '');

		expect(plugin.label).toBe('キーワード検索');
	});

	// TODO: toHeader uses Content.search as the key (e.g. "keyword:bar") but
	// toArray uses Content.title (e.g. "Bar Label"), so eachPage produces
	// "keyword:Bar Label" as the result key. This mismatch means Content-object
	// headers never align with their result values in the report output.
	// Fix: change toArray to use item.search instead of item.title.
	it('builds headers from keywords and selectors', () => {
		const plugin = pluginFactory(
			{
				keywords: ['foo', { search: 'bar', title: 'Bar Label' }],
				selectors: ['.nav', { search: '#main', title: 'Main Area' }],
			},
			'',
		);

		expect(plugin.headers).toEqual({
			'keyword:foo': 'Search keyword: foo',
			'keyword:bar': 'Bar Label',
			'selector:.nav': 'Search selector: .nav',
			'selector:#main': 'Main Area',
		});
	});

	it('returns empty headers when no keywords or selectors are provided', () => {
		const plugin = pluginFactory({}, '');

		expect(plugin.headers).toEqual({});
	});

	it('finds keywords in text content', () => {
		const window = createWindow('<html><body><p>Hello World</p></body></html>');

		const plugin = pluginFactory({ keywords: ['Hello'] }, '');
		const result = plugin.eachPage!({
			url: new URL('https://example.com'),
			html: '',
			window: window as never,
			num: 0,
			total: 1,
		});

		expect(result).toMatchObject({
			page: {
				'keyword:Hello': { value: 1 },
			},
		});
	});

	it('returns zero matches for absent keywords', () => {
		const window = createWindow('<html><body><p>Hello World</p></body></html>');

		const plugin = pluginFactory({ keywords: ['NonExistent'] }, '');
		const result = plugin.eachPage!({
			url: new URL('https://example.com'),
			html: '',
			window: window as never,
			num: 0,
			total: 1,
		});

		expect(result).toMatchObject({
			page: {
				'keyword:NonExistent': { value: 0 },
			},
		});
	});

	it('finds selectors that exist on the page', () => {
		const window = createWindow(
			'<html><body><nav class="breadcrumb">Trail</nav></body></html>',
		);

		const plugin = pluginFactory({ selectors: ['.breadcrumb'] }, '');
		const result = plugin.eachPage!({
			url: new URL('https://example.com'),
			html: '',
			window: window as never,
			num: 0,
			total: 1,
		});

		expect(result).toMatchObject({
			page: {
				'selector:.breadcrumb': { value: true },
			},
		});
	});

	it('does not include absent selectors in result', () => {
		const window = createWindow('<html><body><p>No nav</p></body></html>');

		const plugin = pluginFactory({ selectors: ['.breadcrumb'] }, '');
		const result = plugin.eachPage!({
			url: new URL('https://example.com'),
			html: '',
			window: window as never,
			num: 0,
			total: 1,
		});

		expect(result).toEqual({ page: {} });
	});

	it('returns null when scope element is not found', () => {
		const window = createWindow('<html><body><p>Content</p></body></html>');

		const plugin = pluginFactory({ scope: '#nonexistent', keywords: ['Content'] }, '');
		const result = plugin.eachPage!({
			url: new URL('https://example.com'),
			html: '',
			window: window as never,
			num: 0,
			total: 1,
		});

		expect(result).toBeNull();
	});

	it('scopes keyword search to the specified element', () => {
		const window = createWindow(`
			<html><body>
				<header><p>Header Hello</p></header>
				<main><p>Main Hello</p></main>
			</body></html>
		`);

		const plugin = pluginFactory({ scope: 'main', keywords: ['Hello'] }, '');
		const result = plugin.eachPage!({
			url: new URL('https://example.com'),
			html: '',
			window: window as never,
			num: 0,
			total: 1,
		});

		// Should find only the single match within <main>, not the one in <header>
		expect(result).toMatchObject({
			page: {
				'keyword:Hello': { value: 1 },
			},
		});
	});

	it('deduplicates keyword items', () => {
		const plugin = pluginFactory(
			{
				keywords: ['dup', 'dup', 'unique'],
			},
			'',
		);

		// Headers should have deduplicated keys
		expect(Object.keys(plugin.headers)).toHaveLength(2);
	});

	it('ignores text inside script and style elements', () => {
		const window = createWindow(`
			<html><body>
				<script>var hello = "Hello";</script>
				<style>.Hello { color: red; }</style>
				<p>Visible</p>
			</body></html>
		`);

		const plugin = pluginFactory({ keywords: ['Hello'] }, '');
		const result = plugin.eachPage!({
			url: new URL('https://example.com'),
			html: '',
			window: window as never,
			num: 0,
			total: 1,
		});

		expect(result).toMatchObject({
			page: {
				'keyword:Hello': { value: 0 },
			},
		});
	});

	it('handles invalid selectors gracefully', () => {
		const window = createWindow('<html><body><p>Content</p></body></html>');

		const plugin = pluginFactory({ selectors: ['[[[invalid'] }, '');
		const result = plugin.eachPage!({
			url: new URL('https://example.com'),
			html: '',
			window: window as never,
			num: 0,
			total: 1,
		});

		// Should not throw, invalid selectors are caught
		expect(result).toEqual({ page: {} });
	});

	it('finds keywords in element attributes (alt, title)', () => {
		const window = createWindow(
			'<html><body><img alt="Hello logo" title="Hello"></body></html>',
		);

		const plugin = pluginFactory({ keywords: ['Hello'] }, '');
		const result = plugin.eachPage!({
			url: new URL('https://example.com'),
			html: '',
			window: window as never,
			num: 0,
			total: 1,
		});

		// Should match both alt and title attributes
		expect(result).toMatchObject({
			page: {
				'keyword:Hello': { value: 2 },
			},
		});
	});

	it('skips excluded attributes (href, src, id, class, style, data-*)', () => {
		const window = createWindow(
			'<html><body><a href="Hello" id="Hello" class="Hello" data-value="Hello">text</a></body></html>',
		);

		const plugin = pluginFactory({ keywords: ['Hello'] }, '');
		const result = plugin.eachPage!({
			url: new URL('https://example.com'),
			html: '',
			window: window as never,
			num: 0,
			total: 1,
		});

		// None of the excluded attributes should be matched
		expect(result).toMatchObject({
			page: {
				'keyword:Hello': { value: 0 },
			},
		});
	});
});
