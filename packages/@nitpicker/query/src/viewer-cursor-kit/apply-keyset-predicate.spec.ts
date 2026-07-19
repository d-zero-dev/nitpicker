import { describe, expect, it } from 'vitest';

import { applyKeysetPredicate } from './apply-keyset-predicate.js';

describe('applyKeysetPredicate', () => {
	it('builds a row-value comparison WHERE clause with the given operator and values', () => {
		const calls: { sql: string; bindings: unknown[] }[] = [];
		const qb = {
			whereRaw(sql: string, bindings: unknown[]) {
				calls.push({ sql, bindings });
				return qb;
			},
		};
		applyKeysetPredicate(qb as never, ['url_sort_key', 'resource_id'], '>', [
			'https://example.com/a.css',
			1,
		]);
		expect(calls).toEqual([
			{
				sql: '(url_sort_key, resource_id) > (?, ?)',
				bindings: ['https://example.com/a.css', 1],
			},
		]);
	});

	it('supports the backward-seek operator', () => {
		const calls: { sql: string }[] = [];
		const qb = {
			whereRaw(sql: string) {
				calls.push({ sql });
				return qb;
			},
		};
		applyKeysetPredicate(qb as never, ['image_id'], '<', [42]);
		expect(calls[0]!.sql).toBe('(image_id) < (?)');
	});
});
