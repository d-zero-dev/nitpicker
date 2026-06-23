import { describe, expect, it } from 'vitest';

import { applySetPage } from './apply-set-page.js';

/**
 * Convenience wrapper — `URLSearchParams` is verbose to author in tests.
 * @param record
 */
function from(record: Record<string, string>): URLSearchParams {
	return new URLSearchParams(record);
}

describe('applySetPage', () => {
	it('sets `?page=N` when target is > 1', () => {
		const result = applySetPage(from({}), 5);
		expect(result.get('page')).toBe('5');
	});

	it('deletes `?page=` when target is 1 (canonical first-page URL)', () => {
		const result = applySetPage(from({ page: '5' }), 1);
		expect(result.has('page')).toBe(false);
	});

	it('deletes `?page=` when target is 0 or negative (caller would normally clamp first)', () => {
		expect(applySetPage(from({ page: '5' }), 0).has('page')).toBe(false);
		expect(applySetPage(from({ page: '5' }), -1).has('page')).toBe(false);
	});

	it('replaces an existing `?page=`', () => {
		const result = applySetPage(from({ page: '3' }), 7);
		expect(result.get('page')).toBe('7');
	});

	it('preserves unrelated keys', () => {
		const result = applySetPage(from({ urlPattern: 'foo', sortBy: 'url', page: '2' }), 4);
		expect(result.get('urlPattern')).toBe('foo');
		expect(result.get('sortBy')).toBe('url');
		expect(result.get('page')).toBe('4');
	});

	it('does not mutate the input', () => {
		const input = from({ page: '5' });
		applySetPage(input, 9);
		expect(input.get('page')).toBe('5');
	});

	it('writes large page numbers verbatim (caller is responsible for clamping)', () => {
		// This helper has no `totalPages` context; the PagedTable `useEffect`
		// owns the clamp-and-rewrite cycle. Verifying that the writer is honest
		// about what it gets — no silent truncation.
		const result = applySetPage(from({}), 999_999);
		expect(result.get('page')).toBe('999999');
	});
});
