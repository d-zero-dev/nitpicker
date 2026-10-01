import type {
	TemplateClusterReasonSummary,
	TemplateClusterSummary,
} from '@nitpicker/query';

import { describe, expect, it } from 'vitest';

import { groupClustersByBlock } from './group-clusters-by-block.js';

/**
 * Builds a cluster summary with only the fields the grouping reads.
 * @param key - The template key.
 * @param pageCount - The cluster's page count.
 * @param blocking - Blocking evidence to attach as the cluster's reason.
 * @returns The cluster summary.
 */
function cluster(
	key: string,
	pageCount: number,
	blocking?: TemplateClusterReasonSummary['blocking'],
): TemplateClusterSummary {
	return {
		templateKey: key,
		pageCount,
		commonDirectories: [],
		commonStylesheetUrls: [],
		commonStylesheetFileNames: [],
		reason: blocking
			? {
					clusteredMemberCount: pageCount,
					blocking,
					distinctiveStylesheetUrls: [],
					distinctiveStylesheetFileNames: [],
					structuralCoreTokens: [],
					structuralCoreTokenCount: 0,
					landmarks: [],
					siblingClusterKeys: [],
				}
			: null,
	};
}

describe('groupClustersByBlock', () => {
	it('returns no groups for no clusters', () => {
		expect(groupClustersByBlock([])).toEqual([]);
	});

	it('puts clusters split out of the same block into one group, largest cluster first', () => {
		const small = cluster('["css:abc","cluster:1"]', 2);
		const big = cluster('["css:abc","cluster:0"]', 9);
		const groups = groupClustersByBlock([small, big]);
		expect(groups).toHaveLength(1);
		expect(groups[0]!.block).toEqual({ blockKey: 'css:abc', kind: 'css' });
		expect(groups[0]!.pageCount).toBe(11);
		expect(groups[0]!.clusters).toEqual([big, small]);
	});

	it('lists a cluster merged across blocks under each source block and counts its pages in both', () => {
		const merged = cluster('["orphan-merge:events","cluster:0"]', 13, [
			{
				blockKey: 'orphan-merge:events',
				reason: { kind: 'orphanMerge', pathKey: 'events' },
			},
			{
				blockKey: 'orphan-merge:interviews',
				reason: { kind: 'orphanMerge', pathKey: 'interviews' },
			},
		]);
		const eventsOnly = cluster('["orphan-merge:events","cluster:1"]', 63, [
			{
				blockKey: 'orphan-merge:events',
				reason: { kind: 'orphanMerge', pathKey: 'events' },
			},
		]);
		const groups = groupClustersByBlock([merged, eventsOnly]);
		expect(groups.map((g) => [g.block.blockKey, g.pageCount])).toEqual([
			['orphan-merge:events', 76],
			['orphan-merge:interviews', 13],
		]);
		expect(groups[0]!.clusters).toEqual([eventsOnly, merged]);
		expect(groups[1]!.clusters).toEqual([merged]);
	});

	it('orders groups by total page count descending, then block key for ties', () => {
		const groups = groupClustersByBlock([
			cluster('["path:b","cluster:0"]', 3),
			cluster('["path:a","cluster:0"]', 3),
			cluster('["orphan-merge:news","cluster:0"]', 10),
			cluster('["css:abc","cluster:0"]', 5),
			cluster('["css:abc","cluster:1"]', 5),
		]);
		expect(groups.map((g) => g.block.blockKey)).toEqual([
			'css:abc',
			'orphan-merge:news',
			'path:a',
			'path:b',
		]);
		expect(groups.map((g) => g.block.kind)).toEqual([
			'css',
			'orphanMerge',
			'path',
			'path',
		]);
	});

	it('keeps a cluster with an unparseable template key as its own unknown group', () => {
		const odd = cluster('not-a-json-key', 4);
		const groups = groupClustersByBlock([odd, cluster('["css:abc","cluster:0"]', 1)]);
		expect(groups[0]).toEqual({
			block: { blockKey: 'not-a-json-key', kind: 'unknown' },
			clusters: [odd],
			pageCount: 4,
		});
	});

	it('does not mutate the input array order', () => {
		const input = [
			cluster('["path:b","cluster:0"]', 1),
			cluster('["path:a","cluster:0"]', 9),
		];
		groupClustersByBlock(input);
		expect(input.map((c) => c.templateKey)).toEqual([
			'["path:b","cluster:0"]',
			'["path:a","cluster:0"]',
		]);
	});
});
