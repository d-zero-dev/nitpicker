import { describe, it, expect } from 'vitest';

import { sortedRecord } from './sorted-record.mjs';

describe('sortedRecord', () => {
	it('orders keys by UTF-16 code unit, not locale', () => {
		expect(
			Object.keys(
				sortedRecord([
					['b', '1'],
					['B', '2'],
					['a', '3'],
				]),
			),
		).toEqual(['B', 'a', 'b']);
	});

	it('keeps the values with their keys', () => {
		expect(
			sortedRecord([
				['y', '1'],
				['x', '2'],
			]),
		).toEqual({ x: '2', y: '1' });
	});
});
