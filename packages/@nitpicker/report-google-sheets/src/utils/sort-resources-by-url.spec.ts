import { describe, expect, it } from 'vitest';

import { naturalUrlCollator, sortResourcesByUrl } from './sort-resources-by-url.js';

describe('naturalUrlCollator', () => {
	it('compares numeric segments numerically rather than lexicographically', () => {
		expect(naturalUrlCollator.compare('image-2', 'image-10')).toBeLessThan(0);
		expect(naturalUrlCollator.compare('image-10', 'image-2')).toBeGreaterThan(0);
	});

	it('treats letter case as equal (sensitivity: base)', () => {
		expect(naturalUrlCollator.compare('A.css', 'a.css')).toBe(0);
	});

	it('orders by base letters across cases', () => {
		expect(naturalUrlCollator.compare('apple', 'Banana')).toBeLessThan(0);
	});
});

describe('sortResourcesByUrl', () => {
	it('orders numeric segments numerically rather than lexicographically', () => {
		const input = [
			{ url: 'https://x.example/image-10.jpg' },
			{ url: 'https://x.example/image-2.jpg' },
			{ url: 'https://x.example/image-1.jpg' },
		];
		expect(sortResourcesByUrl(input)).toEqual([
			{ url: 'https://x.example/image-1.jpg' },
			{ url: 'https://x.example/image-2.jpg' },
			{ url: 'https://x.example/image-10.jpg' },
		]);
	});

	it('orders numeric segments inside query strings numerically', () => {
		const input = [
			{ url: 'https://x.example/list?page=10' },
			{ url: 'https://x.example/list?page=2' },
			{ url: 'https://x.example/list?page=1' },
		];
		expect(sortResourcesByUrl(input).map((r) => r.url)).toEqual([
			'https://x.example/list?page=1',
			'https://x.example/list?page=2',
			'https://x.example/list?page=10',
		]);
	});

	it('keeps stable insertion order when URLs compare equal under sensitivity:base', () => {
		const a = { url: 'https://x.example/A.css', id: 1 };
		const b = { url: 'https://x.example/a.css', id: 2 };
		const c = { url: 'https://x.example/B.css', id: 3 };
		expect(sortResourcesByUrl([a, b, c]).map((r) => r.id)).toEqual([1, 2, 3]);
	});

	it('does not mutate the input array', () => {
		const input = [{ url: 'b' }, { url: 'a' }];
		const original = [...input];
		sortResourcesByUrl(input);
		expect(input).toEqual(original);
	});

	it('returns a new array (different reference) even when already sorted', () => {
		const input = [{ url: 'a' }, { url: 'b' }];
		const output = sortResourcesByUrl(input);
		expect(output).not.toBe(input);
		expect(output).toEqual(input);
	});

	it('handles an empty input', () => {
		expect(sortResourcesByUrl([])).toEqual([]);
	});

	it('handles a single resource', () => {
		expect(sortResourcesByUrl([{ url: 'only' }])).toEqual([{ url: 'only' }]);
	});

	it('accepts readonly input arrays', () => {
		const input: readonly { readonly url: string }[] = [{ url: 'b' }, { url: 'a' }];
		expect(sortResourcesByUrl(input).map((r) => r.url)).toEqual(['a', 'b']);
	});
});
