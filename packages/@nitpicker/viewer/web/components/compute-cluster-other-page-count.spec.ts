import type { TemplateClusterSummary } from '@nitpicker/query';

import { describe, expect, it } from 'vitest';

import { computeClusterOtherPageCount } from './compute-cluster-other-page-count.js';

const baseCluster: TemplateClusterSummary = {
	templateKey: '["css:166e4235afcb8b15","cluster:0"]',
	pageCount: 10,
	commonDirectories: [],
	commonStylesheetUrls: [],
	commonStylesheetFileNames: [],
	reason: null,
};

describe('computeClusterOtherPageCount', () => {
	it('returns the full page count when no common directories are known', () => {
		expect(computeClusterOtherPageCount(baseCluster)).toBe(10);
	});

	it('subtracts the sum of common-directory page counts from the total', () => {
		const cluster: TemplateClusterSummary = {
			...baseCluster,
			commonDirectories: [
				{ directory: '/blog/', pageCount: 6 },
				{ directory: '/news/', pageCount: 3 },
			],
		};
		expect(computeClusterOtherPageCount(cluster)).toBe(1);
	});

	it('returns zero when the common directories cover every page', () => {
		const cluster: TemplateClusterSummary = {
			...baseCluster,
			commonDirectories: [{ directory: '/', pageCount: 10 }],
		};
		expect(computeClusterOtherPageCount(cluster)).toBe(0);
	});
});
