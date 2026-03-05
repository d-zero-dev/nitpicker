import { describe, it, expect, vi, beforeEach } from 'vitest';

const execMock = vi.fn();

vi.mock('markuplint', () => ({
	MLEngine: {
		fromCode: vi.fn(() => ({
			exec: execMock,
		})),
	},
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let pluginFactory: typeof import('./index.js').default;

beforeEach(async () => {
	vi.clearAllMocks();
	const mod = await import('./index.js');
	pluginFactory = mod.default;
});

describe('analyze-markuplint plugin', () => {
	it('returns label and headers', () => {
		const plugin = pluginFactory({ config: {} }, '');

		expect(plugin.label).toBe('markuplint: HTMLマークアップ検証');
		expect(plugin.headers).toEqual({ markuplint: 'markuplint' });
	});

	it('returns null when exec() returns null', async () => {
		execMock.mockResolvedValue(null);

		const plugin = pluginFactory({ config: {} }, '');
		const result = await plugin.eachPage!({
			url: new URL('https://example.com/page'),
			html: '<html></html>',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(result).toBeNull();
	});

	it('returns null when exec() returns an Error', async () => {
		execMock.mockResolvedValue(new Error('parse failure'));

		const plugin = pluginFactory({ config: {} }, '');
		const result = await plugin.eachPage!({
			url: new URL('https://example.com/page'),
			html: '<html></html>',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(result).toBeNull();
	});

	it('maps violations to the expected format', async () => {
		execMock.mockResolvedValue({
			violations: [
				{
					severity: 'warning',
					ruleId: 'attr-duplication',
					message: 'Duplicate attribute',
					line: 5,
					col: 10,
				},
			],
		});

		const plugin = pluginFactory({ config: {} }, '');
		const url = new URL('https://example.com/page');
		const result = await plugin.eachPage!({
			url,
			html: '<html></html>',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(result).toEqual({
			page: {
				markuplint: {
					value: '1',
					note: 'Duplicate attribute (attr-duplication)',
				},
			},
			violations: [
				{
					validator: 'markuplint',
					severity: 'warning',
					rule: 'attr-duplication',
					code: '',
					message: 'Duplicate attribute',
					url: 'https://example.com/page (5:10)',
				},
			],
		});
	});

	it('returns zero violations when markuplint finds no issues', async () => {
		execMock.mockResolvedValue({ violations: [] });

		const plugin = pluginFactory({ config: {} }, '');
		const url = new URL('https://example.com/page');
		const result = await plugin.eachPage!({
			url,
			html: '<html></html>',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(result).toEqual({
			page: {
				markuplint: { value: '0', note: '' },
			},
			violations: [],
		});
	});

	it('appends index.html for URLs ending with /', async () => {
		const { MLEngine } = await import('markuplint');
		execMock.mockResolvedValue({ violations: [] });

		const plugin = pluginFactory({ config: {} }, '');
		await plugin.eachPage!({
			url: new URL('https://example.com/dir/'),
			html: '<html></html>',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(MLEngine.fromCode).toHaveBeenCalledWith('<html></html>', {
			name: 'https://example.com/dir/index.html',
			config: {},
		});
	});

	it('keeps URLs already ending with .html as-is', async () => {
		const { MLEngine } = await import('markuplint');
		execMock.mockResolvedValue({ violations: [] });

		const plugin = pluginFactory({ config: {} }, '');
		await plugin.eachPage!({
			url: new URL('https://example.com/page.html'),
			html: '<html></html>',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(MLEngine.fromCode).toHaveBeenCalledWith('<html></html>', {
			name: 'https://example.com/page.html',
			config: {},
		});
	});

	it('appends .html for URLs without extension', async () => {
		const { MLEngine } = await import('markuplint');
		execMock.mockResolvedValue({ violations: [] });

		const plugin = pluginFactory({ config: {} }, '');
		await plugin.eachPage!({
			url: new URL('https://example.com/about'),
			html: '<html></html>',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(MLEngine.fromCode).toHaveBeenCalledWith('<html></html>', {
			name: 'https://example.com/about.html',
			config: {},
		});
	});

	it('passes config from options to MLEngine', async () => {
		const { MLEngine } = await import('markuplint');
		execMock.mockResolvedValue({ violations: [] });

		const customConfig = { rules: { 'attr-duplication': true } };
		const plugin = pluginFactory({ config: customConfig }, '');
		await plugin.eachPage!({
			url: new URL('https://example.com/'),
			html: '<p>test</p>',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(MLEngine.fromCode).toHaveBeenCalledWith('<p>test</p>', {
			name: 'https://example.com/index.html',
			config: customConfig,
		});
	});

	it('collects multiple violations', async () => {
		execMock.mockResolvedValue({
			violations: [
				{
					severity: 'error',
					ruleId: 'rule-a',
					message: 'Error A',
					line: 1,
					col: 1,
				},
				{
					severity: 'warning',
					ruleId: 'rule-b',
					message: 'Warning B',
					line: 2,
					col: 5,
				},
			],
		});

		const plugin = pluginFactory({ config: {} }, '');
		const result = await plugin.eachPage!({
			url: new URL('https://example.com/page'),
			html: '<html></html>',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(result!.violations).toHaveLength(2);
		expect(result!.page!.markuplint.value).toBe('2');
	});
});
