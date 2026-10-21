import { describe, expect, it } from 'vitest';

import { PageIdSet } from './page-id-set.js';

describe('PageIdSet', () => {
	it('reports whether an id was newly added and counts distinct ids', () => {
		const set = new PageIdSet(1000);
		expect(set.add(5)).toBe(true);
		expect(set.add(5)).toBe(false);
		expect(set.add(6)).toBe(true);
		expect(set.size).toBe(2);
	});

	it('starts empty', () => {
		expect(new PageIdSet(10).size).toBe(0);
	});

	it('stays exact across the switch to the bitmap', () => {
		// capacity 100_000 → switches once more than ~520 ids are held.
		const set = new PageIdSet(100_000);
		const added: boolean[] = [];
		for (let id = 1; id <= 2000; id++) {
			added.push(set.add(id));
		}
		expect(added.every(Boolean)).toBe(true);
		expect(set.size).toBe(2000);
		for (let id = 1; id <= 2000; id++) {
			expect(set.add(id)).toBe(false);
		}
		expect(set.size).toBe(2000);
	});

	it('keeps an id seen before the switch distinct after it', () => {
		const set = new PageIdSet(100_000);
		set.add(42);
		for (let id = 1000; id < 3000; id++) {
			set.add(id);
		}
		expect(set.add(42)).toBe(false);
		expect(set.size).toBe(2001);
	});

	it('counts an id outside the capacity, before and after the switch', () => {
		const set = new PageIdSet(100);
		expect(set.add(5000)).toBe(true);
		expect(set.add(5000)).toBe(false);
		for (let id = 0; id < 100; id++) {
			set.add(id);
		}
		expect(set.add(5000)).toBe(false);
		expect(set.add(6000)).toBe(true);
		expect(set.size).toBe(102);
	});

	it('treats id 0 and the capacity boundary correctly', () => {
		const set = new PageIdSet(64);
		for (let id = 0; id < 64; id++) {
			expect(set.add(id)).toBe(true);
		}
		expect(set.add(63)).toBe(false);
		expect(set.add(64)).toBe(true);
		expect(set.size).toBe(65);
	});

	it('works for a zero capacity (an archive with no pages)', () => {
		const set = new PageIdSet(0);
		expect(set.add(1)).toBe(true);
		expect(set.add(1)).toBe(false);
		expect(set.size).toBe(1);
	});

	it('switches to a bitmap once it holds more ids than a bitmap would cost, and not before', () => {
		const set = new PageIdSet(100_000);
		// capacity 100_000 → the switch point is ceil(100_000 / 8 / 24) = 521 ids.
		for (let id = 1; id <= 521; id++) {
			set.add(id);
		}
		expect(set.isBitmap).toBe(false);
		set.add(522);
		expect(set.isBitmap).toBe(true);
		expect(set.size).toBe(522);
	});

	it('stays a hash set for a small group however many times an id repeats', () => {
		const set = new PageIdSet(100_000);
		for (let round = 0; round < 1000; round++) {
			set.add(7);
		}
		expect(set.isBitmap).toBe(false);
		expect(set.size).toBe(1);
	});

	it.each([
		['before the switch', 0],
		['after the switch', 2000],
	])('counts a negative or fractional id exactly, %s', (_label, ids) => {
		const set = new PageIdSet(100_000);
		for (let id = 1; id <= ids; id++) {
			set.add(id);
		}
		expect(set.isBitmap).toBe(ids > 0);
		expect(set.add(-1)).toBe(true);
		expect(set.add(-1)).toBe(false);
		expect(set.add(2.5)).toBe(true);
		expect(set.add(2.5)).toBe(false);
		expect(set.size).toBe(ids + 2);
	});
});
