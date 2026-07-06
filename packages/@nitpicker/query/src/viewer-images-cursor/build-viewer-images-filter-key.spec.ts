import { describe, expect, it } from 'vitest';

import { buildViewerImagesFilterKey } from './build-viewer-images-filter-key.js';

describe('buildViewerImagesFilterKey', () => {
	it('produces the same key for no filters and for undefined filters', () => {
		expect(buildViewerImagesFilterKey({})).toBe(
			buildViewerImagesFilterKey({ missingAlt: undefined }),
		);
	});

	it('produces a different key for a different missingAlt value', () => {
		expect(buildViewerImagesFilterKey({ missingAlt: true })).not.toBe(
			buildViewerImagesFilterKey({ missingAlt: false }),
		);
	});

	it('produces a different key for a different missingDimensions value', () => {
		expect(buildViewerImagesFilterKey({ missingDimensions: true })).not.toBe(
			buildViewerImagesFilterKey({}),
		);
	});

	it('produces a different key for a different oversizedThreshold value — regression test for a stale-cursor-across-threshold-change bug', () => {
		expect(buildViewerImagesFilterKey({ oversizedThreshold: 1000 })).not.toBe(
			buildViewerImagesFilterKey({ oversizedThreshold: 2000 }),
		);
		expect(buildViewerImagesFilterKey({ oversizedThreshold: 1000 })).not.toBe(
			buildViewerImagesFilterKey({}),
		);
	});
});
