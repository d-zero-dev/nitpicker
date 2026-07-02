import { describe, expect, it } from 'vitest';

import { buildLegacyPagesCursors } from './build-legacy-pages-cursors.js';

describe('buildLegacyPagesCursors', () => {
	it('returns a nextCursor when more rows remain beyond this page', () => {
		const result = buildLegacyPagesCursors({
			offset: 0,
			itemCount: 100,
			total: 250,
			limit: 100,
		});
		expect(result.nextCursor).toBe('100');
		expect(result.prevCursor).toBeNull();
	});

	it('returns nextCursor: null on the last page', () => {
		const result = buildLegacyPagesCursors({
			offset: 200,
			itemCount: 50,
			total: 250,
			limit: 100,
		});
		expect(result.nextCursor).toBeNull();
	});

	it('returns nextCursor: null when the page came back empty', () => {
		const result = buildLegacyPagesCursors({
			offset: 500,
			itemCount: 0,
			total: 250,
			limit: 100,
		});
		expect(result.nextCursor).toBeNull();
	});

	it('returns a prevCursor once offset is beyond the first page', () => {
		const result = buildLegacyPagesCursors({
			offset: 100,
			itemCount: 100,
			total: 250,
			limit: 100,
		});
		expect(result.prevCursor).toBe('0');
	});

	it('clamps prevCursor to 0 rather than going negative', () => {
		const result = buildLegacyPagesCursors({
			offset: 50,
			itemCount: 50,
			total: 250,
			limit: 100,
		});
		expect(result.prevCursor).toBe('0');
	});

	it('returns prevCursor: null on the first page (offset 0)', () => {
		const result = buildLegacyPagesCursors({
			offset: 0,
			itemCount: 100,
			total: 250,
			limit: 100,
		});
		expect(result.prevCursor).toBeNull();
	});
});
