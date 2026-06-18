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
	getResourceReferrers: vi.fn().mockResolvedValue({
		resourceUrl: 'https://example.com/style.css',
		pageUrls: [],
		total: 0,
	}),
	listIsolatedPages: vi.fn().mockResolvedValue({ items: [], total: 0 }),
	listUnusedResources: vi.fn().mockResolvedValue({ items: [], total: 0 }),
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
		const { getSummary } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'summary', emptyFlags);
		expect(result).toEqual({ baseUrl: 'https://example.com', totalPages: 10 });
		expect(getSummary).toHaveBeenCalledWith(mockAccessor);
	});

	it('dispatches pages sub-command', async () => {
		const { listPages } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'pages', emptyFlags);
		expect(result).toEqual({ items: [], total: 0, offset: 0, limit: 100 });
		expect(listPages).toHaveBeenCalledWith(mockAccessor, expect.any(Object));
	});

	it('dispatches page-detail sub-command', async () => {
		const { getPageDetail } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'page-detail', {
			url: 'https://example.com',
		} as never);
		expect(result).toEqual({ url: 'https://example.com', status: 200 });
		expect(getPageDetail).toHaveBeenCalledWith(mockAccessor, 'https://example.com');
	});

	it('throws when page-detail returns null', async () => {
		const { getPageDetail } = await import('@nitpicker/query');
		vi.mocked(getPageDetail).mockResolvedValueOnce(null);

		await expect(
			dispatchQuery(mockAccessor, 'page-detail', {
				url: 'https://missing.example.com',
			} as never),
		).rejects.toThrow('Page not found: https://missing.example.com');
	});

	it('dispatches html sub-command', async () => {
		const { getPageHtml } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'html', {
			url: 'https://example.com',
		} as never);
		expect(result).toEqual({ html: '<html></html>', truncated: false });
		expect(getPageHtml).toHaveBeenCalledWith(
			mockAccessor,
			'https://example.com',
			undefined,
		);
	});

	it('dispatches html sub-command with maxLength', async () => {
		const { getPageHtml } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'html', {
			url: 'https://example.com',
			maxLength: 5000,
		} as never);
		expect(result).toEqual({ html: '<html></html>', truncated: false });
		expect(getPageHtml).toHaveBeenCalledWith(mockAccessor, 'https://example.com', 5000);
	});

	it('throws when html returns null', async () => {
		const { getPageHtml } = await import('@nitpicker/query');
		vi.mocked(getPageHtml).mockResolvedValueOnce(null);

		await expect(
			dispatchQuery(mockAccessor, 'html', {
				url: 'https://missing.example.com',
			} as never),
		).rejects.toThrow('Page HTML not found: https://missing.example.com');
	});

	it('dispatches links sub-command', async () => {
		const { listLinks } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'links', {
			type: 'broken',
		} as never);
		expect(result).toEqual({ items: [], total: 0 });
		expect(listLinks).toHaveBeenCalledWith(
			mockAccessor,
			expect.objectContaining({ type: 'broken' }),
		);
	});

	it('dispatches resources sub-command', async () => {
		const { listResources } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'resources', emptyFlags);
		expect(result).toEqual({ items: [], total: 0, offset: 0, limit: 100 });
		expect(listResources).toHaveBeenCalledWith(mockAccessor, expect.any(Object));
	});

	it('dispatches images sub-command', async () => {
		const { listImages } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'images', emptyFlags);
		expect(result).toEqual({ items: [], total: 0, offset: 0, limit: 100 });
		expect(listImages).toHaveBeenCalledWith(mockAccessor, expect.any(Object));
	});

	it('dispatches violations sub-command', async () => {
		const { getViolations } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'violations', emptyFlags);
		expect(result).toEqual({ items: [], total: 0 });
		expect(getViolations).toHaveBeenCalledWith(mockAccessor, expect.any(Object));
	});

	it('dispatches duplicates sub-command with default field', async () => {
		const { findDuplicates } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'duplicates', emptyFlags);
		expect(result).toEqual([]);
		expect(findDuplicates).toHaveBeenCalledWith(mockAccessor, 'title', undefined);
	});

	it('dispatches duplicates sub-command with custom field and limit', async () => {
		const { findDuplicates } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'duplicates', {
			field: 'description',
			limit: 10,
		} as never);
		expect(result).toEqual([]);
		expect(findDuplicates).toHaveBeenCalledWith(mockAccessor, 'description', 10);
	});

	it('dispatches mismatches sub-command', async () => {
		const { findMismatches } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'mismatches', {
			type: 'canonical',
		} as never);
		expect(result).toEqual([]);
		expect(findMismatches).toHaveBeenCalledWith(
			mockAccessor,
			'canonical',
			undefined,
			undefined,
		);
	});

	it('dispatches mismatches sub-command with limit and offset', async () => {
		const { findMismatches } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'mismatches', {
			type: 'og:title',
			limit: 5,
			offset: 10,
		} as never);
		expect(result).toEqual([]);
		expect(findMismatches).toHaveBeenCalledWith(mockAccessor, 'og:title', 5, 10);
	});

	it('dispatches headers sub-command', async () => {
		const { checkHeaders } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'headers', emptyFlags);
		expect(result).toEqual({ items: [], total: 0, offset: 0, limit: 100 });
		expect(checkHeaders).toHaveBeenCalledWith(mockAccessor, expect.any(Object));
	});

	it('dispatches headers sub-command with missingOnly', async () => {
		const { checkHeaders } = await import('@nitpicker/query');
		await dispatchQuery(mockAccessor, 'headers', {
			missingOnly: true,
			limit: 25,
		} as never);
		expect(checkHeaders).toHaveBeenCalledWith(
			mockAccessor,
			expect.objectContaining({ missingOnly: true, limit: 25 }),
		);
	});

	it('dispatches resource-referrers sub-command', async () => {
		const { getResourceReferrers } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'resource-referrers', {
			url: 'https://example.com/style.css',
		} as never);
		expect(result).toEqual({
			resourceUrl: 'https://example.com/style.css',
			pageUrls: [],
			total: 0,
		});
		expect(getResourceReferrers).toHaveBeenCalledWith(
			mockAccessor,
			'https://example.com/style.css',
		);
	});

	it('throws when resource-referrers returns null', async () => {
		const { getResourceReferrers } = await import('@nitpicker/query');
		vi.mocked(getResourceReferrers).mockResolvedValueOnce(null);

		await expect(
			dispatchQuery(mockAccessor, 'resource-referrers', {
				url: 'https://missing.example.com/style.css',
			} as never),
		).rejects.toThrow('Resource not found: https://missing.example.com/style.css');
	});

	it('dispatches isolated-pages sub-command with limit and offset', async () => {
		const { listIsolatedPages } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'isolated-pages', {
			limit: 50,
			offset: 25,
		} as never);
		expect(result).toEqual({ items: [], total: 0 });
		expect(listIsolatedPages).toHaveBeenCalledWith(mockAccessor, {
			limit: 50,
			offset: 25,
		});
	});

	it('dispatches unused-resources sub-command with limit and offset', async () => {
		const { listUnusedResources } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'unused-resources', {
			limit: 10,
			offset: 0,
		} as never);
		expect(result).toEqual({ items: [], total: 0 });
		expect(listUnusedResources).toHaveBeenCalledWith(mockAccessor, {
			limit: 10,
			offset: 0,
		});
	});
});
