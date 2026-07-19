import { describe, expect, it } from 'vitest';

import { buildViewerResourcesFilterKey } from './build-viewer-resources-filter-key.js';

describe('buildViewerResourcesFilterKey', () => {
	it('produces the same key for no filters and for undefined filters', () => {
		expect(buildViewerResourcesFilterKey({})).toBe(
			buildViewerResourcesFilterKey({ isExternal: undefined }),
		);
	});

	it('produces a different key for a different isExternal value', () => {
		expect(buildViewerResourcesFilterKey({ isExternal: true })).not.toBe(
			buildViewerResourcesFilterKey({ isExternal: false }),
		);
	});

	it('produces a different key for a different status value, so a cursor cannot be replayed across a status filter change', () => {
		expect(buildViewerResourcesFilterKey({ status: 200 })).not.toBe(
			buildViewerResourcesFilterKey({ status: 404 }),
		);
		expect(buildViewerResourcesFilterKey({ status: 200 })).not.toBe(
			buildViewerResourcesFilterKey({}),
		);
	});
});
