import { JSDOM } from 'jsdom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@medv/finder', () => ({
	finder: vi.fn(() => 'main'),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let pluginFactory: typeof import('./index.js').default;

beforeEach(async () => {
	vi.clearAllMocks();
	const mod = await import('./index.js');
	pluginFactory = mod.default;
});

/**
 * Creates a JSDOM window from an HTML string.
 * @param html - HTML to parse.
 * @returns The JSDOM window.
 */
function createWindow(html: string) {
	const dom = new JSDOM(html, { url: 'https://example.com' });
	return dom.window;
}

describe('analyze-main-contents plugin', () => {
	it('returns label and headers', () => {
		const plugin = pluginFactory({}, '');

		expect(plugin.label).toBe('メインコンテンツ検出');
		expect(plugin.headers).toEqual({
			wordCount: 'Word count',
			headings: 'Heading count',
			images: 'Image count',
			table: 'Table count',
		});
	});

	it('returns zero counts when no main content element is found', () => {
		const window = createWindow('<html><body><div>No main here</div></body></html>');

		const plugin = pluginFactory({}, '');
		const result = plugin.eachPage!({
			url: new URL('https://example.com'),
			html: '',
			window: window as never,
			num: 0,
			total: 1,
		});

		expect(result).toEqual({
			wordCount: { value: 0 },
			headings: { value: 0 },
			images: { value: 0 },
			table: { value: 0 },
		});
	});

	it('detects <main> element and counts word length', () => {
		const window = createWindow('<html><body><main>こんにちは世界</main></body></html>');

		const plugin = pluginFactory({}, '');
		const result = plugin.eachPage!({
			url: new URL('https://example.com'),
			html: '',
			window: window as never,
			num: 0,
			total: 1,
		});

		expect(result).toMatchObject({
			page: {
				wordCount: { value: 7 },
				headings: { value: 0 },
				images: { value: 0 },
				table: { value: 0 },
			},
		});
	});

	it('detects [role="main"] element', () => {
		const window = createWindow(
			'<html><body><div role="main">Content</div></body></html>',
		);

		const plugin = pluginFactory({}, '');
		const result = plugin.eachPage!({
			url: new URL('https://example.com'),
			html: '',
			window: window as never,
			num: 0,
			total: 1,
		});

		expect(result).toMatchObject({
			page: {
				wordCount: { value: 7 },
			},
		});
	});

	it('uses custom mainContentSelector when provided', () => {
		const window = createWindow(
			'<html><body><section id="page-body">Custom main</section></body></html>',
		);

		const plugin = pluginFactory({ mainContentSelector: '#page-body' }, '');
		const result = plugin.eachPage!({
			url: new URL('https://example.com'),
			html: '',
			window: window as never,
			num: 0,
			total: 1,
		});

		expect(result).toMatchObject({
			page: {
				wordCount: { value: 10 },
			},
		});
	});

	it('extracts headings from main content', () => {
		const window = createWindow(`
			<html><body><main>
				<h1>Title</h1>
				<h2>Subtitle</h2>
				<h3>Section</h3>
			</main></body></html>
		`);

		const plugin = pluginFactory({}, '');
		const result = plugin.eachPage!({
			url: new URL('https://example.com'),
			html: '',
			window: window as never,
			num: 0,
			total: 1,
		});

		expect(result).toMatchObject({
			page: {
				headings: { value: 3 },
			},
		});
	});

	it('extracts images from main content', () => {
		const window = createWindow(`
			<html><body><main>
				<img src="a.png" alt="Image A">
				<img src="b.png" alt="Image B">
				<input type="image" src="c.png" alt="Image C">
			</main></body></html>
		`);

		const plugin = pluginFactory({}, '');
		const result = plugin.eachPage!({
			url: new URL('https://example.com'),
			html: '',
			window: window as never,
			num: 0,
			total: 1,
		});

		expect(result).toMatchObject({
			page: {
				images: { value: 3 },
			},
		});
	});

	it('extracts table metadata from main content', () => {
		const window = createWindow(`
			<html><body><main>
				<table>
					<thead><tr><th>A</th><th>B</th></tr></thead>
					<tfoot><tr><td>Footer</td><td></td></tr></tfoot>
					<tbody>
						<tr><td colspan="2">Merged</td></tr>
						<tr><td>1</td><td>2</td></tr>
					</tbody>
				</table>
			</main></body></html>
		`);

		const plugin = pluginFactory({}, '');
		const result = plugin.eachPage!({
			url: new URL('https://example.com'),
			html: '',
			window: window as never,
			num: 0,
			total: 1,
		});

		expect(result).toMatchObject({
			page: {
				table: {
					value: 1,
					note: expect.stringContaining('| r | c | h | f | m |'),
				},
			},
		});
	});

	it('handles whitespace-only text content as zero word count', () => {
		const window = createWindow('<html><body><main>   \n\t  </main></body></html>');

		const plugin = pluginFactory({}, '');
		const result = plugin.eachPage!({
			url: new URL('https://example.com'),
			html: '',
			window: window as never,
			num: 0,
			total: 1,
		});

		expect(result).toMatchObject({
			page: {
				wordCount: { value: 0 },
			},
		});
	});

	it('detects #content fallback selector', () => {
		const window = createWindow(
			'<html><body><div id="content">Fallback content</div></body></html>',
		);

		const plugin = pluginFactory({}, '');
		const result = plugin.eachPage!({
			url: new URL('https://example.com'),
			html: '',
			window: window as never,
			num: 0,
			total: 1,
		});

		expect(result).toMatchObject({
			page: {
				wordCount: { value: 15 },
			},
		});
	});

	it('detects .main fallback selector', () => {
		const window = createWindow(
			'<html><body><div class="main">Class-based main</div></body></html>',
		);

		const plugin = pluginFactory({}, '');
		const result = plugin.eachPage!({
			url: new URL('https://example.com'),
			html: '',
			window: window as never,
			num: 0,
			total: 1,
		});

		// "Class-basedmain" = 15 characters (whitespace stripped, hyphen kept)
		expect(result).toMatchObject({
			page: {
				wordCount: { value: 15 },
			},
		});
	});

	it('returns first matching element in DOM order when multiple selectors match', () => {
		// querySelector with comma-separated selectors returns the first match
		// in DOM order. Here <main> appears before #content in the DOM.
		const window = createWindow(`
			<html><body>
				<main>Semantic main</main>
				<div id="content">ID content</div>
			</body></html>
		`);

		const plugin = pluginFactory({}, '');
		const result = plugin.eachPage!({
			url: new URL('https://example.com'),
			html: '',
			window: window as never,
			num: 0,
			total: 1,
		});

		// "Semanticmain" = 12 characters (whitespace stripped)
		expect(result).toMatchObject({
			page: {
				wordCount: { value: 12 },
			},
		});
	});
});
