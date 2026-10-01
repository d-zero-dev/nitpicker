import type {
	TemplateClusterLandmarkSummary,
	TemplateClusterSummary,
} from '@nitpicker/query';

import { describe, expect, it } from 'vitest';

import { computeTemplateClusterOverview } from './compute-template-cluster-overview.js';

/**
 * Builds a landmark summary with only the fields the aggregation reads.
 * @param type - The landmark type.
 * @param presenceRate - Share of member pages carrying it, 0–1.
 * @returns The landmark summary.
 */
function landmark(
	type: TemplateClusterLandmarkSummary['type'],
	presenceRate: number,
): TemplateClusterLandmarkSummary {
	return {
		type,
		presenceRate,
		chromeRate: 0,
		memberCountWithInstance: 0,
		shellTokens: [],
		shellTokenCount: 0,
	};
}

/**
 * Builds a cluster summary; `reason` is `null` unless `landmarks` is given.
 * @param key - The template key.
 * @param pageCount - The cluster's page count.
 * @param landmarks - Landmark summaries to attach as the cluster's reason.
 * @returns The cluster summary.
 */
function cluster(
	key: string,
	pageCount: number,
	landmarks?: TemplateClusterLandmarkSummary[],
): TemplateClusterSummary {
	return {
		templateKey: key,
		pageCount,
		commonDirectories: [],
		commonStylesheetUrls: [],
		commonStylesheetFileNames: [],
		reason: landmarks
			? {
					clusteredMemberCount: pageCount,
					blocking: [],
					distinctiveStylesheetUrls: [],
					distinctiveStylesheetFileNames: [],
					structuralCoreTokens: [],
					structuralCoreTokenCount: 0,
					landmarks,
					siblingClusterKeys: [],
				}
			: null,
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
			landmarks: [],
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

	it('weights landmark presence by page count over clusters that have a reason', () => {
		const overview = computeTemplateClusterOverview([
			cluster('a', 30, [landmark('header', 1), landmark('footer', 0.5)]),
			cluster('b', 10, [landmark('header', 0.5)]),
			// No reason: excluded from the denominator and from clusterCount.
			cluster('c', 100),
		]);
		expect(overview.landmarks).toEqual([
			{ type: 'header', clusterCount: 2, averagePresenceRate: 0.875 },
			{ type: 'footer', clusterCount: 1, averagePresenceRate: 0.375 },
		]);
	});
});
