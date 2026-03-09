import { describe, it, expect, vi, beforeEach } from 'vitest';

const killMock = vi.fn();
const launchMock = vi.fn();
const lighthouseMock = vi.fn();

vi.mock('chrome-launcher', () => ({
	launch: launchMock,
}));

vi.mock('lighthouse', () => ({
	default: lighthouseMock,
}));

vi.mock('lighthouse/report/renderer/report-utils.js', () => ({
	ReportUtils: {
		prepareReportResult: vi.fn((lhr: unknown) => lhr),
		calculateRating: vi.fn((score: number | null) =>
			score === null
				? 'error'
				: score >= 0.9
					? 'pass'
					: score >= 0.5
						? 'average'
						: 'fail',
		),
	},
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let pluginFactory: typeof import('./lighthouse-plugin.js').default;

beforeEach(async () => {
	vi.clearAllMocks();
	launchMock.mockResolvedValue({ port: 9222, kill: killMock });
	const mod = await import('./lighthouse-plugin.js');
	pluginFactory = mod.default;
});

describe('analyze-lighthouse plugin', () => {
	it('calls chrome.kill() after lighthouse succeeds', async () => {
		lighthouseMock.mockResolvedValue({
			lhr: {
				categories: {
					performance: {
						id: 'performance',
						title: 'Performance',
						score: 0.9,
						auditRefs: [],
					},
					accessibility: {
						id: 'accessibility',
						title: 'Accessibility',
						score: 0.85,
						auditRefs: [],
					},
					'best-practices': {
						id: 'best-practices',
						title: 'Best Practices',
						score: 0.95,
						auditRefs: [],
					},
					seo: { id: 'seo', title: 'SEO', score: 0.8, auditRefs: [] },
				},
			},
		});

		const plugin = pluginFactory({}, '');
		const url = new URL('https://example.com');
		await plugin.eachPage!({ url, html: '', window: {} as never, num: 0, total: 1 });

		expect(killMock).toHaveBeenCalledTimes(1);
	});

	it('calls chrome.kill() when lighthouse returns an Error', async () => {
		lighthouseMock.mockRejectedValue(new Error('Navigation timeout'));

		const plugin = pluginFactory({}, '');
		const url = new URL('https://example.com');
		const result = await plugin.eachPage!({
			url,
			html: '',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(killMock).toHaveBeenCalledTimes(1);
		expect(result).toEqual({
			page: {
				performance: { value: 0, note: 'Error' },
				accessibility: { value: 0, note: 'Error' },
				'best-practices': { value: 0, note: 'Error' },
				seo: { value: 0, note: 'Error' },
			},
		});
	});

	it('calls chrome.kill() when lighthouse returns null', async () => {
		lighthouseMock.mockResolvedValue(null);

		const plugin = pluginFactory({}, '');
		const url = new URL('https://example.com');
		const result = await plugin.eachPage!({
			url,
			html: '',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(killMock).toHaveBeenCalledTimes(1);
		expect(result).toEqual({
			page: {
				performance: { value: 0, note: 'Error' },
				accessibility: { value: 0, note: 'Error' },
				'best-practices': { value: 0, note: 'Error' },
				seo: { value: 0, note: 'Error' },
			},
		});
	});

	it('wraps non-Error exceptions into Error and returns error result', async () => {
		lighthouseMock.mockRejectedValue('unexpected string throw');

		const plugin = pluginFactory({}, '');
		const url = new URL('https://example.com');
		const result = await plugin.eachPage!({
			url,
			html: '',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(killMock).toHaveBeenCalledTimes(1);
		expect(result).toEqual({
			page: {
				performance: { value: 0, note: 'Error' },
				accessibility: { value: 0, note: 'Error' },
				'best-practices': { value: 0, note: 'Error' },
				seo: { value: 0, note: 'Error' },
			},
		});
	});

	it('propagates unexpected errors from report processing without swallowing them', async () => {
		lighthouseMock.mockResolvedValue({
			lhr: {
				categories: null,
			},
		});

		const plugin = pluginFactory({}, '');
		const url = new URL('https://example.com');

		await expect(
			plugin.eachPage!({ url, html: '', window: {} as never, num: 0, total: 1 }),
		).rejects.toThrow();

		expect(killMock).toHaveBeenCalledTimes(1);
	});

	it('does not call chrome.kill() when chromeLauncher.launch() itself fails', async () => {
		launchMock.mockRejectedValue(new Error('Chrome not found'));

		const plugin = pluginFactory({}, '');
		const url = new URL('https://example.com');

		await expect(
			plugin.eachPage!({ url, html: '', window: {} as never, num: 0, total: 1 }),
		).rejects.toThrow('Chrome not found');

		expect(killMock).not.toHaveBeenCalled();
	});

	it('passes options.config to lighthouse as the third argument', async () => {
		const customConfig = {
			extends: 'lighthouse:default',
			settings: { onlyCategories: ['performance'] },
		};
		lighthouseMock.mockResolvedValue({
			lhr: {
				categories: {
					performance: {
						id: 'performance',
						title: 'Performance',
						score: 1,
						auditRefs: [],
					},
					accessibility: {
						id: 'accessibility',
						title: 'Accessibility',
						score: 1,
						auditRefs: [],
					},
					'best-practices': {
						id: 'best-practices',
						title: 'Best Practices',
						score: 1,
						auditRefs: [],
					},
					seo: { id: 'seo', title: 'SEO', score: 1, auditRefs: [] },
				},
			},
		});

		const plugin = pluginFactory({ config: customConfig }, '');
		const url = new URL('https://example.com');
		await plugin.eachPage!({ url, html: '', window: {} as never, num: 0, total: 1 });

		expect(lighthouseMock).toHaveBeenCalledWith(
			'https://example.com/',
			{ port: 9222 },
			customConfig,
		);
	});

	it('returns rounded category scores from the lighthouse report', async () => {
		lighthouseMock.mockResolvedValue({
			lhr: {
				categories: {
					performance: {
						id: 'performance',
						title: 'Performance',
						score: 0.876,
						auditRefs: [],
					},
					accessibility: {
						id: 'accessibility',
						title: 'Accessibility',
						score: 0.934,
						auditRefs: [],
					},
					'best-practices': {
						id: 'best-practices',
						title: 'Best Practices',
						score: 0.5,
						auditRefs: [],
					},
					seo: { id: 'seo', title: 'SEO', score: 0.123, auditRefs: [] },
				},
			},
		});

		const plugin = pluginFactory({}, '');
		const url = new URL('https://example.com');
		const result = await plugin.eachPage!({
			url,
			html: '',
			window: {} as never,
			num: 0,
			total: 1,
		});

		expect(result).toMatchObject({
			page: {
				performance: { value: 88 },
				accessibility: { value: 93 },
				'best-practices': { value: 50 },
				seo: { value: 12 },
			},
		});
	});
});
