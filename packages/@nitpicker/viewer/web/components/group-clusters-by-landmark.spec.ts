import type {
	TemplateClusterLandmarkSummary,
	TemplateClusterSummary,
} from '@nitpicker/query';

import { describe, expect, it } from 'vitest';

import { groupClustersByLandmark } from './group-clusters-by-landmark.js';

/**
 * Builds a landmark summary with only the fields the grouping reads.
 * @param type - The landmark type.
 * @returns The landmark summary.
 */
function landmark(
	type: TemplateClusterLandmarkSummary['type'],
): TemplateClusterLandmarkSummary {
	return {
		type,
		presenceRate: 1,
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

describe('groupClustersByLandmark', () => {
	it('returns no groups when no cluster carries a landmark', () => {
		expect(groupClustersByLandmark([cluster('a', 3), cluster('b', 2, [])])).toEqual([]);
	});

	it('lists a cluster in every group it carries, in stable type order', () => {
		const a = cluster('a', 5, [landmark('nav'), landmark('header')]);
		const groups = groupClustersByLandmark([a]);
		expect(groups.map((g) => g.type)).toEqual(['header', 'nav']);
		expect(groups[0]!.entries[0]!.cluster).toBe(a);
		expect(groups[1]!.entries[0]!.cluster).toBe(a);
	});

	it('sorts entries by page count descending and omits empty groups', () => {
		const groups = groupClustersByLandmark([
			cluster('small', 2, [landmark('footer')]),
			cluster('big', 9, [landmark('footer')]),
			cluster('noReason', 50),
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0]!.type).toBe('footer');
		expect(groups[0]!.entries.map((e) => e.cluster.templateKey)).toEqual([
			'big',
			'small',
		]);
	});
});
