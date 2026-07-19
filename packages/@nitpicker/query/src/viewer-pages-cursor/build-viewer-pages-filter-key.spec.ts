import { describe, expect, it } from 'vitest';

import { buildViewerPagesFilterKey } from './build-viewer-pages-filter-key.js';

describe('buildViewerPagesFilterKey', () => {
	it('produces the same key for equivalent filters regardless of key order', () => {
		const a = buildViewerPagesFilterKey({ isExternal: false, status: 200 });
		const b = buildViewerPagesFilterKey({ status: 200, isExternal: false });
		expect(a).toBe(b);
	});

	it('produces different keys for different filter values', () => {
		const a = buildViewerPagesFilterKey({ isExternal: false });
		const b = buildViewerPagesFilterKey({ isExternal: true });
		expect(a).not.toBe(b);
	});

	it('treats omitted and explicit-undefined filters identically', () => {
		const a = buildViewerPagesFilterKey({});
		const b = buildViewerPagesFilterKey({ isExternal: undefined, source: undefined });
		expect(a).toBe(b);
	});

	it('distinguishes an unfiltered key from every single-filter key', () => {
		const none = buildViewerPagesFilterKey({});
		const withNoindex = buildViewerPagesFilterKey({ noindex: true });
		const withSource = buildViewerPagesFilterKey({ source: 'inventory-seed' });
		expect(none).not.toBe(withNoindex);
		expect(none).not.toBe(withSource);
		expect(withNoindex).not.toBe(withSource);
	});
});
