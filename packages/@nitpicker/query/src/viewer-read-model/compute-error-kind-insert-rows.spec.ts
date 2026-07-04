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
		total: 0,
		channelSource: 'crawl_errors',
		groups: [],
		...overrides,
	};
}

describe('computeErrorKindInsertRows', () => {
	it('returns empty row arrays and a meta row of total 0 for a clean result', () => {
		const rows = computeErrorKindInsertRows(
			makeResult({ total: 0, channelSource: 'none' }),
		);
		expect(rows).toEqual({
			groups: [],
			hosts: [],
			samples: [],
			meta: { total: 0, channel_source: 'none' },
		});
	});

	it('flattens one groups row per kind, preserving the input order', () => {
		const rows = computeErrorKindInsertRows(
			makeResult({
				total: 3,
				groups: [
					{ kind: 'timeout', count: 2, hosts: [], sampleUrls: [] },
					{ kind: 'dns', count: 1, hosts: [], sampleUrls: [] },
				],
			}),
		);
		expect(rows.groups).toEqual([
			{ kind: 'timeout', count: 2 },
			{ kind: 'dns', count: 1 },
		]);
	});

	it('flattens the per-kind hosts into (kind, host, count) rows', () => {
		const rows = computeErrorKindInsertRows(
			makeResult({
				total: 3,
				groups: [
					{
						kind: 'dns',
						count: 3,
						hosts: [
							{ host: 'a.example.com', count: 2 },
							{ host: 'b.example.com', count: 1 },
						],
						sampleUrls: [],
					},
				],
			}),
		);
		expect(rows.hosts).toEqual([
			{ kind: 'dns', host: 'a.example.com', count: 2 },
			{ kind: 'dns', host: 'b.example.com', count: 1 },
		]);
	});

	it('flattens the per-kind sampleUrls into (kind, rank, url) rows, ranked by array position', () => {
		const rows = computeErrorKindInsertRows(
			makeResult({
				total: 2,
				groups: [
					{
						kind: 'timeout',
						count: 2,
						hosts: [],
						sampleUrls: ['https://a.example.com/', 'https://b.example.com/'],
					},
				],
			}),
		);
		expect(rows.samples).toEqual([
			{ kind: 'timeout', rank: 0, url: 'https://a.example.com/' },
			{ kind: 'timeout', rank: 1, url: 'https://b.example.com/' },
		]);
	});

	it('carries total/channelSource into a single meta row unchanged', () => {
		const rows = computeErrorKindInsertRows(
			makeResult({ total: 42, channelSource: 'error.log' }),
		);
		expect(rows.meta).toEqual({ total: 42, channel_source: 'error.log' });
	});

	it('keeps rows from different kinds independent when multiple groups each have hosts and samples', () => {
		const rows = computeErrorKindInsertRows(
			makeResult({
				total: 4,
				groups: [
					{
						kind: 'dns',
						count: 2,
						hosts: [{ host: 'a.example.com', count: 2 }],
						sampleUrls: ['https://a.example.com/'],
					},
					{
						kind: 'timeout',
						count: 2,
						hosts: [{ host: 'b.example.com', count: 2 }],
						sampleUrls: ['https://b.example.com/'],
					},
				],
			}),
		);
		expect(rows.hosts).toEqual([
			{ kind: 'dns', host: 'a.example.com', count: 2 },
			{ kind: 'timeout', host: 'b.example.com', count: 2 },
		]);
		expect(rows.samples).toEqual([
			{ kind: 'dns', rank: 0, url: 'https://a.example.com/' },
			{ kind: 'timeout', rank: 0, url: 'https://b.example.com/' },
		]);
	});
});
