import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiGet } from './api-client.js';

describe('apiGet', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.stubGlobal('location', { origin: 'https://viewer.example' });
		fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ ok: true }),
		});
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	/**
	 * Reads back the query string `fetch` was called with.
	 * @returns The requested URL's search-param string.
	 */
	function requestedSearch(): string {
		const requestedUrl = fetchMock.mock.calls[0]?.[0] as URL;
		return requestedUrl.search;
	}

	it('omits a key entirely when its value is undefined', async () => {
		await apiGet('/api/pages', { status: undefined });
		expect(requestedSearch()).toBe('');
	});

	it('serializes a scalar value as a single key=value pair', async () => {
		await apiGet('/api/pages', { status: 200 });
		expect(requestedSearch()).toBe('?status=200');
	});

	it('serializes an array as one repeated key per element', async () => {
		await apiGet('/api/pages', { status: ['200', '404'] });
		expect(requestedSearch()).toBe('?status=200&status=404');
	});

	it('serializes a numeric array element the same as a string one', async () => {
		await apiGet('/api/pages', { status: [200, 404] });
		expect(requestedSearch()).toBe('?status=200&status=404');
	});

	it('omits the key entirely for an empty array (no filter, not match-nothing)', async () => {
		await apiGet('/api/pages', { status: [], urlPattern: 'x' });
		expect(requestedSearch()).toBe('?urlPattern=x');
	});

	it('mixes scalar and array params in the same request', async () => {
		await apiGet('/api/pages', { status: ['200', '404'], sortBy: 'url' });
		expect(requestedSearch()).toBe('?status=200&status=404&sortBy=url');
	});
});
