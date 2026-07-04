import type { ErrorKindsResult } from '../types.js';

import { describe, expect, it } from 'vitest';

import { computeErrorKindInsertRows } from './compute-error-kind-insert-rows.js';

/**
 * Builds a minimal {@link ErrorKindsResult} with sensible defaults,
 * overridable per test.
 * @param overrides - Fields to override.
 * @returns The constructed result.
 */
function makeResult(overrides: Partial<ErrorKindsResult>): ErrorKindsResult {
	return {
		items: [],
		total: 0,
		facets: { totalRecords: 0, channelSource: 'crawl_errors' },
		...overrides,
	};
}

describe('computeErrorKindInsertRows', () => {
	it('returns an empty entries array and a meta row of total_records 0 for a clean result', () => {
		const rows = computeErrorKindInsertRows(
			makeResult({ facets: { totalRecords: 0, channelSource: 'none' } }),
		);
		expect(rows).toEqual({
			entries: [],
			meta: { total_records: 0, channel_source: 'none' },
		});
	});

	it('maps one entries row per host×kind item, deriving sort keys from host/kind verbatim', () => {
		const rows = computeErrorKindInsertRows(
			makeResult({
				total: 2,
				items: [
					{
						host: 'a.example.com',
						kind: 'dns',
						count: 2,
						sampleUrls: [],
						overflowedCount: 0,
					},
					{
						host: 'b.example.com',
						kind: 'timeout',
						count: 1,
						sampleUrls: [],
						overflowedCount: 0,
					},
				],
			}),
		);
		expect(rows.entries).toEqual([
			{
				host: 'a.example.com',
				kind: 'dns',
				count: 2,
				sample_urls_json: '[]',
				overflowed_count: 0,
				host_sort_key: 'a.example.com',
				kind_sort_key: 'dns',
			},
			{
				host: 'b.example.com',
				kind: 'timeout',
				count: 1,
				sample_urls_json: '[]',
				overflowed_count: 0,
				host_sort_key: 'b.example.com',
				kind_sort_key: 'timeout',
			},
		]);
	});

	it('JSON-stringifies sampleUrls and carries overflowedCount through unchanged', () => {
		const rows = computeErrorKindInsertRows(
			makeResult({
				total: 1,
				items: [
					{
						host: 'a.example.com',
						kind: 'dns',
						count: 60,
						sampleUrls: ['https://a.example.com/1', 'https://a.example.com/2'],
						overflowedCount: 10,
					},
				],
			}),
		);
		expect(rows.entries[0]).toMatchObject({
			sample_urls_json: JSON.stringify([
				'https://a.example.com/1',
				'https://a.example.com/2',
			]),
			overflowed_count: 10,
		});
	});

	it('carries facets.totalRecords/channelSource into a single meta row, renamed to the table column names', () => {
		const rows = computeErrorKindInsertRows(
			makeResult({ facets: { totalRecords: 42, channelSource: 'error.log' } }),
		);
		expect(rows.meta).toEqual({ total_records: 42, channel_source: 'error.log' });
	});

	it('preserves input item order (the caller is responsible for passing an already-sorted, unfiltered result)', () => {
		const rows = computeErrorKindInsertRows(
			makeResult({
				total: 2,
				items: [
					{
						host: 'z.example.com',
						kind: 'dns',
						count: 1,
						sampleUrls: [],
						overflowedCount: 0,
					},
					{
						host: 'a.example.com',
						kind: 'timeout',
						count: 5,
						sampleUrls: [],
						overflowedCount: 0,
					},
				],
			}),
		);
		expect(rows.entries.map((e) => e.host)).toEqual(['z.example.com', 'a.example.com']);
	});
});
