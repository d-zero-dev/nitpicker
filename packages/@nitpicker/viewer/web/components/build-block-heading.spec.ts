import type { ClusterBlockGroup } from '../types.js';
import type { TemplateClusterSummary } from '@nitpicker/query';

import { describe, expect, it } from 'vitest';

import { buildBlockHeading } from './build-block-heading.js';

/**
 * Builds a cluster summary with only the fields the heading reads.
 * @param overrides - Fields to set on top of an otherwise empty cluster.
 * @returns The cluster summary.
 */
function cluster(overrides: Partial<TemplateClusterSummary>): TemplateClusterSummary {
	return {
		templateKey: '["css:abc","cluster:0"]',
		pageCount: 1,
		commonDirectories: [],
		commonStylesheetUrls: [],
		commonStylesheetFileNames: [],
		reason: null,
		...overrides,
	};
}

/**
 * Builds a cluster summary whose reason carries the given distinctive names.
 * @param names - The reason's `distinctiveStylesheetFileNames`.
 * @returns The cluster summary.
 */
function clusterWithDistinctive(names: string[]): TemplateClusterSummary {
	return cluster({
		reason: {
			clusteredMemberCount: 1,
			blocking: [],
			distinctiveStylesheetUrls: [],
			distinctiveStylesheetFileNames: names,
			structuralCoreTokens: [],
			structuralCoreTokenCount: 0,
			landmarks: [],
			siblingClusterKeys: [],
		},
	});
}

/**
 * Wraps clusters into a block group.
 * @param blockKey - The group's block key.
 * @param kind - The group's block kind.
 * @param clusters - The member clusters.
 * @returns The block group.
 */
function group(
	blockKey: string,
	kind: ClusterBlockGroup['block']['kind'],
	clusters: TemplateClusterSummary[],
): ClusterBlockGroup {
	return { block: { blockKey, kind }, clusters, pageCount: 0 };
}

describe('buildBlockHeading', () => {
	it('renders a path block as its directory', () => {
		expect(buildBlockHeading(group('path:news', 'path', []))).toBe('/news/');
	});

	it('renders an orphan-merge block as its directory', () => {
		expect(buildBlockHeading(group('orphan-merge:blogs', 'orphanMerge', []))).toBe(
			'/blogs/',
		);
	});

	it('renders the empty site-root segment as a bare slash', () => {
		expect(buildBlockHeading(group('path:', 'path', []))).toBe('/');
	});

	it('unions, dedupes and sorts distinctive stylesheet names across a css block', () => {
		const heading = buildBlockHeading(
			group('css:abc', 'css', [
				clusterWithDistinctive(['slick.css', 'product.css']),
				clusterWithDistinctive(['product.css']),
			]),
		);
		expect(heading).toBe('product.css, slick.css');
	});

	it('falls back to common stylesheet names when no member captured a reason', () => {
		const heading = buildBlockHeading(
			group('css:abc', 'css', [cluster({ commonStylesheetFileNames: ['site.css'] })]),
		);
		expect(heading).toBe('site.css');
	});

	it('falls back to the largest member top directory, then the raw block key', () => {
		expect(
			buildBlockHeading(
				group('css:abc', 'css', [
					cluster({
						commonDirectories: [{ directory: 'https://example.com/a/', pageCount: 3 }],
					}),
				]),
			),
		).toBe('https://example.com/a/');
		expect(buildBlockHeading(group('css:abc', 'css', [cluster({})]))).toBe('css:abc');
		expect(buildBlockHeading(group('dom:xyz', 'unknown', [cluster({})]))).toBe('dom:xyz');
	});
});
