import { describe, it, expect } from 'vitest';

import { eachSplitted } from './each-splitted.js';

describe('eachSplitted', () => {
	it('splits array into chunks and calls callback on each', async () => {
		const chunks: number[][] = [];
		await eachSplitted([1, 2, 3, 4, 5], 2, (items) => {
			chunks.push(items);
		});
		expect(chunks).toEqual([[1, 2], [3, 4], [5]]);
	});

	it('handles empty array', async () => {
		const chunks: number[][] = [];
		await eachSplitted([], 2, (items) => {
			chunks.push(items);
		});
		expect(chunks).toEqual([]);
	});

	it('handles chunk size larger than array', async () => {
		const chunks: number[][] = [];
		await eachSplitted([1, 2], 10, (items) => {
			chunks.push(items);
		});
		expect(chunks).toEqual([[1, 2]]);
	});

	it('supports async callback', async () => {
		const results: string[] = [];
		await eachSplitted(['a', 'b', 'c'], 1, async (items) => {
			await new Promise((resolve) => setTimeout(resolve, 1));
			results.push(...items);
		});
		expect(results.toSorted()).toEqual(['a', 'b', 'c']);
	});
});
