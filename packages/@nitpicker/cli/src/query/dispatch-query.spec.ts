import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { dispatchQuery } from './dispatch-query.js';

vi.mock('@nitpicker/query', () => ({
	getSummary: vi
		.fn()
		.mockResolvedValue({ baseUrl: 'https://example.com', totalPages: 10 }),
	listPages: vi.fn().mockResolvedValue({ items: [], total: 0, offset: 0, limit: 100 }),
	getPageDetail: vi.fn().mockResolvedValue({ url: 'https://example.com', status: 200 }),
	getPageHtml: vi.fn().mockResolvedValue({ html: '<html></html>', truncated: false }),
	listLinks: vi.fn().mockResolvedValue({ items: [], total: 0 }),
	listResources: vi
		.fn()
		.mockResolvedValue({ items: [], total: 0, offset: 0, limit: 100 }),
	listImages: vi.fn().mockResolvedValue({ items: [], total: 0, offset: 0, limit: 100 }),
	getViolations: vi.fn().mockResolvedValue({ items: [], total: 0 }),
	findDuplicates: vi.fn().mockResolvedValue([]),
	findMismatches: vi.fn().mockResolvedValue([]),
	checkHeaders: vi.fn().mockResolvedValue({ items: [], total: 0, offset: 0, limit: 100 }),
	getResourceReferrers: vi
		.fn()
		.mockResolvedValue({
			resourceUrl: 'https://example.com/style.css',
			pageUrls: [],
			total: 0,
		}),
	ArchiveManager: vi.fn(),
}));

/** Mock accessor for testing dispatch calls. */
const mockAccessor = {} as never;

/** Default empty flags for testing. */
const emptyFlags = {} as never;

describe('dispatchQuery', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('dispatches summary sub-command', async () => {
		const result = await dispatchQuery(mockAccessor, 'summary', emptyFlags);
		expect(result).toEqual({ baseUrl: 'https://example.com', totalPages: 10 });
	});

	it('dispatches pages sub-command', async () => {
		const result = await dispatchQuery(mockAccessor, 'pages', emptyFlags);
		expect(result).toEqual({ items: [], total: 0, offset: 0, limit: 100 });
	});

	it('dispatches page-detail sub-command', async () => {
		const result = await dispatchQuery(mockAccessor, 'page-detail', {
			url: 'https://example.com',
		} as never);
		expect(result).toEqual({ url: 'https://example.com', status: 200 });
	});

	it('throws when page-detail returns null', async () => {
		const { getPageDetail } = await import('@nitpicker/query');
		vi.mocked(getPageDetail).mockResolvedValueOnce(null);

		await expect(
			dispatchQuery(mockAccessor, 'page-detail', { url: 'https://missing.com' } as never),
		).rejects.toThrow('Page not found: https://missing.com');
	});

	it('dispatches html sub-command', async () => {
		const result = await dispatchQuery(mockAccessor, 'html', {
			url: 'https://example.com',
		} as never);
		expect(result).toEqual({ html: '<html></html>', truncated: false });
	});

	it('throws when html returns null', async () => {
		const { getPageHtml } = await import('@nitpicker/query');
		vi.mocked(getPageHtml).mockResolvedValueOnce(null);

		await expect(
			dispatchQuery(mockAccessor, 'html', { url: 'https://missing.com' } as never),
		).rejects.toThrow('Page HTML not found: https://missing.com');
	});

	it('dispatches links sub-command', async () => {
		const result = await dispatchQuery(mockAccessor, 'links', {
			type: 'broken',
		} as never);
		expect(result).toEqual({ items: [], total: 0 });
	});

	it('dispatches resources sub-command', async () => {
		const result = await dispatchQuery(mockAccessor, 'resources', emptyFlags);
		expect(result).toEqual({ items: [], total: 0, offset: 0, limit: 100 });
	});

	it('dispatches images sub-command', async () => {
		const result = await dispatchQuery(mockAccessor, 'images', emptyFlags);
		expect(result).toEqual({ items: [], total: 0, offset: 0, limit: 100 });
	});

	it('dispatches violations sub-command', async () => {
		const result = await dispatchQuery(mockAccessor, 'violations', emptyFlags);
		expect(result).toEqual({ items: [], total: 0 });
	});

	it('dispatches duplicates sub-command', async () => {
		const result = await dispatchQuery(mockAccessor, 'duplicates', emptyFlags);
		expect(result).toEqual([]);
	});

	it('dispatches mismatches sub-command', async () => {
		const result = await dispatchQuery(mockAccessor, 'mismatches', {
			type: 'canonical',
		} as never);
		expect(result).toEqual([]);
	});

	it('dispatches headers sub-command', async () => {
		const result = await dispatchQuery(mockAccessor, 'headers', emptyFlags);
		expect(result).toEqual({ items: [], total: 0, offset: 0, limit: 100 });
	});

	it('dispatches resource-referrers sub-command', async () => {
		const result = await dispatchQuery(mockAccessor, 'resource-referrers', {
			url: 'https://example.com/style.css',
		} as never);
		expect(result).toEqual({
			resourceUrl: 'https://example.com/style.css',
			pageUrls: [],
			total: 0,
		});
	});

	it('throws when resource-referrers returns null', async () => {
		const { getResourceReferrers } = await import('@nitpicker/query');
		vi.mocked(getResourceReferrers).mockResolvedValueOnce(null);

		await expect(
			dispatchQuery(mockAccessor, 'resource-referrers', {
				url: 'https://missing.com/style.css',
			} as never),
		).rejects.toThrow('Resource not found: https://missing.com/style.css');
	});
});
