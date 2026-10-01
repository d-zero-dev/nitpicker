import type { TemplateClusterSummary } from '@nitpicker/query';

import { describe, expect, it } from 'vitest';

import { computeTemplateClusterOverview } from './compute-template-cluster-overview.js';

/**
 * Builds a cluster summary with only the fields the aggregation reads.
 * @param key - The template key.
 * @param pageCount - The cluster's page count.
 * @returns The cluster summary.
 */
function cluster(key: string, pageCount: number): TemplateClusterSummary {
	return {
		templateKey: key,
		pageCount,
		commonDirectories: [],
		commonStylesheetUrls: [],
		commonStylesheetFileNames: [],
		reason: null,
	};
}

describe('computeTemplateClusterOverview', () => {
	it('returns zeroed totals and four empty buckets for no clusters', () => {
		const overview = computeTemplateClusterOverview([]);
		expect(overview).toEqual({
			clusterCount: 0,
			totalPageCount: 0,
			singletonClusterCount: 0,
			topClusters: [],
			sizeBuckets: [
				{ key: 'single', clusterCount: 0, pageCount: 0 },
				{ key: 'small', clusterCount: 0, pageCount: 0 },
				{ key: 'medium', clusterCount: 0, pageCount: 0 },
				{ key: 'large', clusterCount: 0, pageCount: 0 },
			],
			blockGroups: [],
			blockCount: 0,
			blockKinds: [],
		});
	});

	it('sums pages, counts singletons, and buckets by size at the range boundaries', () => {
		const overview = computeTemplateClusterOverview([
			cluster('a', 1),
			cluster('b', 2),
			cluster('c', 5),
			cluster('d', 6),
			cluster('e', 20),
			cluster('f', 21),
		]);
		expect(overview.clusterCount).toBe(6);
		expect(overview.totalPageCount).toBe(55);
		expect(overview.singletonClusterCount).toBe(1);
		expect(overview.sizeBuckets).toEqual([
			{ key: 'single', clusterCount: 1, pageCount: 1 },
			{ key: 'small', clusterCount: 2, pageCount: 7 },
			{ key: 'medium', clusterCount: 2, pageCount: 26 },
			{ key: 'large', clusterCount: 1, pageCount: 21 },
		]);
	});

	it('returns the top N clusters by page count descending without mutating the input', () => {
		const input = [cluster('a', 3), cluster('b', 30), cluster('c', 10), cluster('d', 20)];
		const overview = computeTemplateClusterOverview(input, 2);
		expect(overview.topClusters.map((c) => c.templateKey)).toEqual(['b', 'd']);
		expect(input.map((c) => c.templateKey)).toEqual(['a', 'b', 'c', 'd']);
	});

	it('defaults to the top 5 clusters', () => {
		const input = Array.from({ length: 8 }, (_, i) => cluster(`k${i}`, i + 1));
		expect(computeTemplateClusterOverview(input).topClusters).toHaveLength(5);
	});

	it('counts blocks and breaks them down by kind in css / path / orphanMerge / unknown order', () => {
		const overview = computeTemplateClusterOverview([
			cluster('["path:news","cluster:0"]', 2),
			cluster('["css:abc","cluster:0"]', 30),
			cluster('["css:abc","cluster:1"]', 10),
			cluster('["orphan-merge:blogs","cluster:0"]', 5),
			cluster('["css:def","cluster:0"]', 1),
		]);
		expect(overview.blockCount).toBe(4);
		expect(overview.blockGroups.map((g) => g.block.blockKey)).toEqual([
			'css:abc',
			'orphan-merge:blogs',
			'path:news',
			'css:def',
		]);
		expect(overview.blockKinds).toEqual([
			{ kind: 'css', blockCount: 2, clusterCount: 3, pageCount: 41 },
			{ kind: 'path', blockCount: 1, clusterCount: 1, pageCount: 2 },
			{ kind: 'orphanMerge', blockCount: 1, clusterCount: 1, pageCount: 5 },
		]);
	});

	it('counts a cluster merged across blocks once (first block) in the kind breakdown but in every block for blockCount', () => {
		const merged: TemplateClusterSummary = {
			...cluster('["css:abc","cluster:0"]', 10),
			reason: {
				clusteredMemberCount: 10,
				blocking: [
					{
						blockKey: 'css:abc',
						reason: { kind: 'css', distinctiveStylesheetHrefs: [] },
					},
					{ blockKey: 'path:news', reason: { kind: 'path', pathKey: 'news' } },
				],
				distinctiveStylesheetUrls: [],
				distinctiveStylesheetFileNames: [],
				structuralCoreTokens: [],
				structuralCoreTokenCount: 0,
				landmarks: [],
				siblingClusterKeys: [],
			},
		};
		const overview = computeTemplateClusterOverview([
			merged,
			cluster('["path:news","cluster:1"]', 2),
		]);
		expect(overview.clusterCount).toBe(2);
		expect(overview.totalPageCount).toBe(12);
		expect(overview.blockCount).toBe(2);
		expect(overview.blockKinds).toEqual([
			{ kind: 'css', blockCount: 1, clusterCount: 1, pageCount: 10 },
			{ kind: 'path', blockCount: 1, clusterCount: 1, pageCount: 2 },
		]);
	});

	it('omits block kinds no cluster has', () => {
		const overview = computeTemplateClusterOverview([
			cluster('["path:a","cluster:0"]', 1),
		]);
		expect(overview.blockKinds).toEqual([
			{ kind: 'path', blockCount: 1, clusterCount: 1, pageCount: 1 },
		]);
	});
});
