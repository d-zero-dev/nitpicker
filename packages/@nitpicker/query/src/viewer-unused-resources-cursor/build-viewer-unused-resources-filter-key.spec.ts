import { describe, expect, it } from 'vitest';

import { buildViewerUnusedResourcesFilterKey } from './build-viewer-unused-resources-filter-key.js';

describe('buildViewerUnusedResourcesFilterKey', () => {
	it('produces the same key for no filters and for undefined filters', () => {
		expect(buildViewerUnusedResourcesFilterKey({})).toBe(
			buildViewerUnusedResourcesFilterKey({ source: undefined }),
		);
	});

	it('produces a different key for a different source value', () => {
		expect(buildViewerUnusedResourcesFilterKey({ source: 'crawled' })).not.toBe(
			buildViewerUnusedResourcesFilterKey({ source: 'inventory-seed' }),
		);
	});

	it('produces a different key for a different status value — regression test for a stale-cursor-across-status-change bug', () => {
		expect(buildViewerUnusedResourcesFilterKey({ status: 200 })).not.toBe(
			buildViewerUnusedResourcesFilterKey({ status: 404 }),
		);
		expect(buildViewerUnusedResourcesFilterKey({ status: 200 })).not.toBe(
			buildViewerUnusedResourcesFilterKey({}),
		);
	});
});
