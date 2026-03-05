import { JSDOM } from 'jsdom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let pluginFactory: typeof import('./index.js').default;

beforeEach(async () => {
	vi.clearAllMocks();
	const mod = await import('./index.js');
	pluginFactory = mod.default;
});

/**
 * Creates a JSDOM window from an HTML string and installs global `Node`
 * so that `recursiveSearch` can reference `Node.TEXT_NODE` / `Node.ELEMENT_NODE`.
 * @param html - HTML to parse.
 * @returns The JSDOM window.
 */
function createWindow(html: string) {
	const dom = new JSDOM(html, { url: 'https://example.com' });
	// recursiveSearch references the global `Node` constant
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(globalThis as any).Node = dom.window.Node;
	return dom.window;
}

afterEach(() => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	delete (globalThis as any).Node;
});

describe('analyze-search plugin', () => {
	it('returns label', () => {
		const plugin = pluginFactory({}, '');

		expect(plugin.label).toBe('キーワード検索');
	});

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
				'keyword:Hello': { value: expect.any(Number) },
			},
		});
		// @ts-expect-error -- dynamic key access
		expect(result.page['keyword:Hello'].value).toBeGreaterThan(0);
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

		// Should find matches only within <main>
		expect(result).toMatchObject({
			page: {
				'keyword:Hello': { value: expect.any(Number) },
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
});
