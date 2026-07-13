import { describe, expect, it } from 'vitest';

import { GRAPH_COLORS } from './graph-colors.js';
import { pickNodeColor } from './pick-node-color.js';

describe('pickNodeColor', () => {
	it('crawled 健全ページは crawled 色', () => {
		expect(pickNodeColor(200, 'crawled')).toBe(GRAPH_COLORS.crawled);
	});

	it('inventory-seed 健全ページは inventorySeed 色', () => {
		expect(pickNodeColor(200, 'inventory-seed')).toBe(GRAPH_COLORS.inventorySeed);
	});

	it('inventory-discovered 健全ページは inventoryDiscovered 色', () => {
		expect(pickNodeColor(200, 'inventory-discovered')).toBe(
			GRAPH_COLORS.inventoryDiscovered,
		);
	});

	it('status が null のときは source の色を返す', () => {
		expect(pickNodeColor(null, 'crawled')).toBe(GRAPH_COLORS.crawled);
		expect(pickNodeColor(null, 'inventory-seed')).toBe(GRAPH_COLORS.inventorySeed);
	});

	it('4xx は source を問わず error 色 (error > source 優先)', () => {
		expect(pickNodeColor(404, 'crawled')).toBe(GRAPH_COLORS.error);
		expect(pickNodeColor(404, 'inventory-seed')).toBe(GRAPH_COLORS.error);
		expect(pickNodeColor(404, 'inventory-discovered')).toBe(GRAPH_COLORS.error);
	});

	it('5xx は source を問わず error 色', () => {
		expect(pickNodeColor(500, 'crawled')).toBe(GRAPH_COLORS.error);
		expect(pickNodeColor(503, 'inventory-seed')).toBe(GRAPH_COLORS.error);
	});

	it('status = 399 (境界) は error 色にならない', () => {
		expect(pickNodeColor(399, 'crawled')).toBe(GRAPH_COLORS.crawled);
	});

	it('status = 400 (境界) は error 色になる', () => {
		expect(pickNodeColor(400, 'crawled')).toBe(GRAPH_COLORS.error);
	});

	it('3xx redirect は error 色にならない', () => {
		expect(pickNodeColor(301, 'crawled')).toBe(GRAPH_COLORS.crawled);
	});
});
