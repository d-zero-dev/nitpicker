import { describe, expect, it } from 'vitest';

import { applyFilterUpdates } from './apply-filter-updates.js';

describe('applyFilterUpdates', () => {
	it('sets every key in one pass', () => {
		const next = applyFilterUpdates(new URLSearchParams('type=all'), [
			['host', 'a.example'],
			['kind', 'dns'],
		]);

		expect(next.toString()).toBe('type=all&host=a.example&kind=dns');
	});

	it('deletes a key whose value is empty', () => {
		const next = applyFilterUpdates(new URLSearchParams('host=a.example&kind=dns'), [
			['host', ''],
			['kind', ''],
		]);

		expect(next.toString()).toBe('');
	});

	it('appends each value of an array as a repeated key, dropping empty ones', () => {
		const next = applyFilterUpdates(new URLSearchParams(), [
			['status', ['200', '', '404']],
		]);

		expect(next.getAll('status')).toStrictEqual(['200', '404']);
	});

	it('clears ?page= when a non-page key changes', () => {
		const next = applyFilterUpdates(new URLSearchParams('page=3'), [
			['host', 'a.example'],
		]);

		expect(next.has('page')).toBe(false);
		expect(next.get('host')).toBe('a.example');
	});

	it('keeps ?page= when only page changes', () => {
		const next = applyFilterUpdates(new URLSearchParams('host=a.example'), [
			['page', '2'],
		]);

		expect(next.toString()).toBe('host=a.example&page=2');
	});

	it('returns the same instance when nothing changes, leaving ?page= alone', () => {
		const prev = new URLSearchParams('host=a.example&page=3');
		const next = applyFilterUpdates(prev, [['host', 'a.example']]);

		expect(next).toBe(prev);
		expect(next.get('page')).toBe('3');
	});

	it('returns the same instance when an array equals the current repeated values', () => {
		const prev = new URLSearchParams('status=200&status=404&page=3');
		const next = applyFilterUpdates(prev, [['status', ['200', '404']]]);

		expect(next).toBe(prev);
	});

	it('treats a reordered array as a change', () => {
		const next = applyFilterUpdates(new URLSearchParams('status=200&status=404'), [
			['status', ['404', '200']],
		]);

		expect(next.getAll('status')).toStrictEqual(['404', '200']);
	});

	it('deletes the key when given an empty array', () => {
		const next = applyFilterUpdates(new URLSearchParams('status=200&status=404'), [
			['status', []],
		]);

		expect(next.has('status')).toBe(false);
	});

	it('drops an explicitly set ?page= when a non-page key changes in the same call', () => {
		const next = applyFilterUpdates(new URLSearchParams(), [
			['page', '2'],
			['host', 'a.example'],
		]);

		expect(next.toString()).toBe('host=a.example');
	});

	it('does not mutate the params it was given', () => {
		const prev = new URLSearchParams('host=a.example&page=3');
		applyFilterUpdates(prev, [['host', 'b.example']]);

		expect(prev.toString()).toBe('host=a.example&page=3');
	});
});
