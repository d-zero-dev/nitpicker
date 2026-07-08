import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { dispatchQuery } from './dispatch-query.js';

vi.mock('@nitpicker/query', () => ({
	getSummaryFastPath: vi
		.fn()
		.mockResolvedValue({ baseUrl: 'https://example.com', totalPages: 10 }),
	getErrorKindsFastPath: vi
		.fn()
		.mockResolvedValue({ total: 0, channelSource: 'none', groups: [] }),
	listPages: vi.fn().mockResolvedValue({ items: [], total: 0, offset: 0, limit: 100 }),
	getPageDetail: vi.fn().mockResolvedValue({ url: 'https://example.com', status: 200 }),
	getPageHtml: vi.fn().mockResolvedValue({ html: '<html></html>', truncated: false }),
	listLinks: vi.fn().mockResolvedValue({ items: [], total: 0 }),
	listResources: vi
		.fn()
		.mockResolvedValue({ items: [], total: 0, offset: 0, limit: 100 }),
	getImagesFastPath: vi
		.fn()
		.mockResolvedValue({ items: [], total: 0, offset: 0, limit: 100 }),
	getViolations: vi.fn().mockResolvedValue({ items: [], total: 0 }),
	getDuplicatesFastPath: vi.fn().mockResolvedValue({
		items: [],
		total: 0,
		limit: 50,
		offset: 0,
		nextCursor: null,
		prevCursor: null,
	}),
	getMismatchesFastPath: vi.fn().mockResolvedValue({
		items: [],
		total: 0,
		limit: 100,
		offset: 0,
		nextCursor: null,
		prevCursor: null,
	}),
	getHeaderChecksFastPath: vi
		.fn()
		.mockResolvedValue({ items: [], total: 0, offset: 0, limit: 100 }),
	getResourceReferrers: vi.fn().mockResolvedValue({
		resourceUrl: 'https://example.com/style.css',
		pageUrls: [],
		total: 0,
	}),
	listInventoryRuns: vi.fn().mockResolvedValue({ items: [], total: 0 }),
	listIsolatedPagesFastPath: vi.fn().mockResolvedValue({ items: [], total: 0 }),
	listIsolatedClustersFastPath: vi.fn().mockResolvedValue({ items: [], total: 0 }),
	getIsolatedClusterFastPath: vi.fn().mockResolvedValue(null),
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
		const { getSummaryFastPath } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'summary', emptyFlags);
		expect(result).toEqual({ baseUrl: 'https://example.com', totalPages: 10 });
		expect(getSummaryFastPath).toHaveBeenCalledWith(mockAccessor);
	});

	it('dispatches error-kinds sub-command through the fast path, not the legacy function directly', async () => {
		const { getErrorKindsFastPath } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'error-kinds', emptyFlags);
		expect(result).toEqual({ total: 0, channelSource: 'none', groups: [] });
		expect(getErrorKindsFastPath).toHaveBeenCalledWith(mockAccessor);
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
		const { getImagesFastPath } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'images', emptyFlags);
		expect(result).toEqual({ items: [], total: 0, offset: 0, limit: 100 });
		expect(getImagesFastPath).toHaveBeenCalledWith(mockAccessor, expect.any(Object));
	});

	it('dispatches violations sub-command', async () => {
		const { getViolations } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'violations', emptyFlags);
		expect(result).toEqual({ items: [], total: 0 });
		expect(getViolations).toHaveBeenCalledWith(mockAccessor, expect.any(Object));
	});

	it('dispatches duplicates sub-command with default field through the fast path', async () => {
		const { getDuplicatesFastPath } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'duplicates', emptyFlags);
		expect(result).toEqual({
			items: [],
			total: 0,
			limit: 50,
			offset: 0,
			nextCursor: null,
			prevCursor: null,
		});
		expect(getDuplicatesFastPath).toHaveBeenCalledWith(
			mockAccessor,
			expect.objectContaining({ field: 'title' }),
		);
	});

	it('dispatches duplicates sub-command with custom field, limit, pagesLimit, cursor, direction', async () => {
		const { getDuplicatesFastPath } = await import('@nitpicker/query');
		await dispatchQuery(mockAccessor, 'duplicates', {
			field: 'description',
			limit: 10,
			pagesLimit: 5,
			cursor: 'abc',
			direction: 'prev',
		} as never);
		expect(getDuplicatesFastPath).toHaveBeenCalledWith(mockAccessor, {
			field: 'description',
			limit: 10,
			pagesLimit: 5,
			cursor: 'abc',
			direction: 'prev',
			offset: undefined,
		});
	});

	it('dispatches mismatches sub-command through the fast path', async () => {
		const { getMismatchesFastPath } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'mismatches', {
			type: 'canonical',
		} as never);
		expect(result).toEqual({
			items: [],
			total: 0,
			limit: 100,
			offset: 0,
			nextCursor: null,
			prevCursor: null,
		});
		expect(getMismatchesFastPath).toHaveBeenCalledWith(mockAccessor, 'canonical', {
			limit: undefined,
			offset: undefined,
			cursor: undefined,
			direction: undefined,
		});
	});

	it('dispatches mismatches sub-command with limit, offset, cursor, direction', async () => {
		const { getMismatchesFastPath } = await import('@nitpicker/query');
		await dispatchQuery(mockAccessor, 'mismatches', {
			type: 'og:title',
			limit: 5,
			offset: 10,
			cursor: 'xyz',
			direction: 'next',
		} as never);
		expect(getMismatchesFastPath).toHaveBeenCalledWith(mockAccessor, 'og:title', {
			limit: 5,
			offset: 10,
			cursor: 'xyz',
			direction: 'next',
		});
	});

	it('dispatches headers sub-command', async () => {
		const { getHeaderChecksFastPath } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'headers', emptyFlags);
		expect(result).toEqual({ items: [], total: 0, offset: 0, limit: 100 });
		expect(getHeaderChecksFastPath).toHaveBeenCalledWith(
			mockAccessor,
			expect.any(Object),
		);
	});

	it('dispatches headers sub-command with missingOnly', async () => {
		const { getHeaderChecksFastPath } = await import('@nitpicker/query');
		await dispatchQuery(mockAccessor, 'headers', {
			missingOnly: true,
			limit: 25,
		} as never);
		expect(getHeaderChecksFastPath).toHaveBeenCalledWith(
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
		expect(getResourceReferrers).toHaveBeenCalledWith(mockAccessor, {
			resourceUrl: 'https://example.com/style.css',
			limit: undefined,
			cursor: undefined,
		});
	});

	it('dispatches resource-referrers sub-command with limit and cursor', async () => {
		const { getResourceReferrers } = await import('@nitpicker/query');
		await dispatchQuery(mockAccessor, 'resource-referrers', {
			url: 'https://example.com/style.css',
			limit: 10,
			cursor: '5',
		} as never);
		expect(getResourceReferrers).toHaveBeenCalledWith(mockAccessor, {
			resourceUrl: 'https://example.com/style.css',
			limit: 10,
			cursor: '5',
		});
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
		const { listIsolatedPagesFastPath } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'isolated-pages', {
			limit: 50,
			offset: 25,
		} as never);
		expect(result).toEqual({ items: [], total: 0 });
		expect(listIsolatedPagesFastPath).toHaveBeenCalledWith(mockAccessor, {
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

	it('dispatches inventory-runs sub-command with limit and offset', async () => {
		const { listInventoryRuns } = await import('@nitpicker/query');
		const result = await dispatchQuery(mockAccessor, 'inventory-runs', {
			limit: 25,
			offset: 5,
		} as never);
		expect(result).toEqual({ items: [], total: 0 });
		expect(listInventoryRuns).toHaveBeenCalledWith(mockAccessor, {
			limit: 25,
			offset: 5,
		});
	});
});
