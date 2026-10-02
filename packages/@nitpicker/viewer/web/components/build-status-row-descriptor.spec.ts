import { describe, expect, it } from 'vitest';

import { buildStatusRowDescriptor } from './build-status-row-descriptor.js';

const t = (key: string) => (key === 'common.statusFetchError' ? 'Fetch error' : key);

describe('buildStatusRowDescriptor', () => {
	it('uses the numeric status as both key and label for a regular row', () => {
		expect(buildStatusRowDescriptor({ status: 200, count: 10 }, t)).toEqual({
			key: '200',
			label: '200',
		});
	});

	it('keeps the plain 404 row (fix-target broken pages) undecorated', () => {
		expect(buildStatusRowDescriptor({ status: 404, count: 2 }, t)).toEqual({
			key: '404',
			label: '404',
		});
	});

	it('suffixes the inventory-seed 404 row so its key cannot collide with the plain 404 row', () => {
		expect(
			buildStatusRowDescriptor({ status: 404, count: 1200, inventorySeed: true }, t),
		).toEqual({
			key: '404-inventory-seed',
			label: '404 (inventory-seed)',
		});
	});

	it('maps a null status to the "none" key and an em-dash label', () => {
		expect(buildStatusRowDescriptor({ status: null, count: 1 }, t)).toEqual({
			key: 'none',
			label: '—',
		});
	});

	it('labels the -1 hard-failure sentinel as a fetch error while keeping its numeric key', () => {
		expect(buildStatusRowDescriptor({ status: -1, count: 3 }, t)).toEqual({
			key: '-1',
			label: 'Fetch error',
		});
	});
});
