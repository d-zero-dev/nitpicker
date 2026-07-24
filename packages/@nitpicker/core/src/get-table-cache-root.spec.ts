import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const mockGetArchiveCacheRoot = vi.fn(() => '/mock-cache-root');

vi.mock('@nitpicker/crawler', () => ({
	getArchiveCacheRoot: mockGetArchiveCacheRoot,
}));

describe('getTableCacheRoot', () => {
	it('returns a "table" subdirectory of getArchiveCacheRoot()', async () => {
		const { getTableCacheRoot } = await import('./get-table-cache-root.js');
		expect(getTableCacheRoot()).toBe(path.join('/mock-cache-root', 'table'));
	});

	it('delegates root resolution to getArchiveCacheRoot rather than computing its own', async () => {
		const { getTableCacheRoot } = await import('./get-table-cache-root.js');
		getTableCacheRoot();
		expect(mockGetArchiveCacheRoot).toHaveBeenCalled();
	});
});
