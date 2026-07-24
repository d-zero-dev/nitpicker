import type { ArchiveCacheEntry } from '@nitpicker/crawler';

import { describe, expect, it } from 'vitest';

import { formatCacheList } from './format-cache-list.js';

describe('formatCacheList', () => {
	it('reports "no cache entries" when the list is empty', () => {
		expect(formatCacheList([], '/tmp/nitpicker/cache')).toBe(
			'No cache entries found under /tmp/nitpicker/cache',
		);
	});

	it('includes the cache root, each entry, and a total row', () => {
		const entries: ArchiveCacheEntry[] = [
			{
				kind: 'tar-cache',
				name: '12345-abcd-example',
				path: '/tmp/nitpicker/cache/12345-abcd-example',
				sizeBytes: 1024,
				mtimeMs: Date.parse('2026-07-20T03:11:02.000Z'),
			},
			{
				kind: 'table',
				name: 'table',
				path: '/tmp/nitpicker/cache/table',
				sizeBytes: 2048,
				mtimeMs: Date.parse('2026-07-24T09:00:00.000Z'),
			},
		];

		const output = formatCacheList(entries, '/tmp/nitpicker/cache');

		expect(output).toContain('Cache root: /tmp/nitpicker/cache');
		expect(output).toContain('tar-cache');
		expect(output).toContain('12345-abcd-example');
		expect(output).toContain('2026-07-20T03:11:02.000Z');
		expect(output).toContain('table');
		expect(output).toContain('2026-07-24T09:00:00.000Z');
		expect(output).toContain('Total: 3.0 KB across 2 entries');
	});
});
