import { describe, expect, it } from 'vitest';

import { buildDemoPageDetail } from './demo-page-detail-fixtures.js';

describe('buildDemoPageDetail', () => {
	it('returns a fully-populated PageDetail when called with no overrides', () => {
		const detail = buildDemoPageDetail();
		expect(detail.url).toBe('https://example.com/');
		expect(detail.status).toBe(200);
		expect(detail.isExternal).toBe(false);
		expect(detail.outboundLinks).toEqual([]);
		expect(detail.redirectFrom).toEqual([]);
		expect(detail.consoleLogs).toEqual([]);
	});

	it('applies overrides on top of the defaults', () => {
		const detail = buildDemoPageDetail({
			isDedupeCapped: true,
			dedupeCapEventId: 7,
			dedupeCapShapeKey: 'shape-a',
		});
		expect(detail.isDedupeCapped).toBe(true);
		expect(detail.dedupeCapEventId).toBe(7);
		expect(detail.dedupeCapShapeKey).toBe('shape-a');
		// Unrelated defaults remain untouched.
		expect(detail.url).toBe('https://example.com/');
	});

	it('does not mutate the same object across calls', () => {
		const first = buildDemoPageDetail({ title: 'First' });
		const second = buildDemoPageDetail();
		expect(first.title).toBe('First');
		expect(second.title).toBe('Example Page');
	});
});
