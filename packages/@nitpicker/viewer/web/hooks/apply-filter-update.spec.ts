import { describe, expect, it } from 'vitest';

import { applyFilterUpdate } from './apply-filter-update.js';

/**
 * Convenience wrapper — `URLSearchParams` is verbose to author in tests.
 * @param record
 */
function from(record: Record<string, string>): URLSearchParams {
	return new URLSearchParams(record);
}

describe('applyFilterUpdate', () => {
	it('sets a new value when the value is truthy', () => {
		const result = applyFilterUpdate(from({}), 'urlPattern', '%foo%');
		expect(result.get('urlPattern')).toBe('%foo%');
	});

	it('replaces an existing value', () => {
		const result = applyFilterUpdate(from({ urlPattern: 'old' }), 'urlPattern', 'new');
		expect(result.get('urlPattern')).toBe('new');
	});

	it('deletes the key when the value is empty', () => {
		const result = applyFilterUpdate(from({ urlPattern: 'old' }), 'urlPattern', '');
		expect(result.has('urlPattern')).toBe(false);
	});

	it('clears `?page=` as a side effect of any non-page update', () => {
		const result = applyFilterUpdate(
			from({ urlPattern: 'old', page: '5' }),
			'urlPattern',
			'new',
		);
		expect(result.has('page')).toBe(false);
	});

	it('clears `?page=` even when deleting another key', () => {
		const result = applyFilterUpdate(
			from({ urlPattern: 'old', page: '3' }),
			'urlPattern',
			'',
		);
		expect(result.has('page')).toBe(false);
	});

	it('preserves `?page=` when the update target is `page` itself', () => {
		const result = applyFilterUpdate(from({ page: '2' }), 'page', '7');
		expect(result.get('page')).toBe('7');
	});

	it('preserves unrelated keys', () => {
		const result = applyFilterUpdate(
			from({ urlPattern: 'old', sortBy: 'url', other: 'kept' }),
			'urlPattern',
			'new',
		);
		expect(result.get('sortBy')).toBe('url');
		expect(result.get('other')).toBe('kept');
	});

	it('does not mutate the input', () => {
		const input = from({ urlPattern: 'old', page: '5' });
		applyFilterUpdate(input, 'urlPattern', 'new');
		expect(input.get('urlPattern')).toBe('old');
		expect(input.get('page')).toBe('5');
	});
});
