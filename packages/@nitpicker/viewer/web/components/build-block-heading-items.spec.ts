import type { ClusterBlockGroup } from '../types.js';
import type { TemplateClusterSummary } from '@nitpicker/query';

import { describe, expect, it } from 'vitest';

import { buildBlockHeadingItems } from './build-block-heading-items.js';

/**
 *
 * @param overrides
 */
function cluster(overrides: Partial<TemplateClusterSummary>): TemplateClusterSummary {
	return {
		templateKey: '["css:abc","cluster:0"]',
		label: null,
		pageCount: 3,
		commonDirectories: [],
		commonStylesheetUrls: [],
		commonStylesheetFileNames: [],
		reason: null,
		...overrides,
	};
}

/**
 *
 * @param blockKey
 * @param kind
 * @param clusters
 */
function group(
	blockKey: string,
	kind: ClusterBlockGroup['block']['kind'],
	clusters: TemplateClusterSummary[],
): ClusterBlockGroup {
	return {
		block: { blockKey, kind } as ClusterBlockGroup['block'],
		clusters,
		pageCount: clusters.reduce((acc, c) => acc + c.pageCount, 0),
	};
}

describe('buildBlockHeadingItems', () => {
	it('returns a path block as a single directory item', () => {
		expect(buildBlockHeadingItems(group('path:news', 'path', []))).toEqual(['/news/']);
	});

	it('returns each stylesheet name of a css block as its own item, deduped and sorted', () => {
		const items = buildBlockHeadingItems(
			group('css:abc', 'css', [
				cluster({ commonStylesheetFileNames: ['slick.css', 'product.css'] }),
				cluster({ commonStylesheetFileNames: ['product.css'] }),
			]),
		);
		expect(items).toEqual(['product.css', 'slick.css']);
	});

	it('returns an orphan-merge block as its directory and the site root as a bare slash', () => {
		expect(
			buildBlockHeadingItems(group('orphan-merge:blogs', 'orphanMerge', [])),
		).toEqual(['/blogs/']);
		expect(buildBlockHeadingItems(group('path:', 'path', []))).toEqual(['/']);
	});

	it('unions distinctive stylesheet names across a css block, ahead of common ones', () => {
		const withDistinctive = (names: string[]) =>
			cluster({
				commonStylesheetFileNames: ['ignored.css'],
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
		expect(
			buildBlockHeadingItems(
				group('css:abc', 'css', [
					withDistinctive(['slick.css', 'product.css']),
					withDistinctive(['product.css']),
				]),
			),
		).toEqual(['product.css', 'slick.css']);
	});

	it('falls back to the largest member top directory, then the raw block key', () => {
		expect(
			buildBlockHeadingItems(
				group('css:abc', 'css', [
					cluster({
						commonDirectories: [{ directory: 'https://example.com/a/', pageCount: 3 }],
					}),
				]),
			),
		).toEqual(['https://example.com/a/']);
		expect(buildBlockHeadingItems(group('css:abc', 'css', [cluster({})]))).toEqual([
			'css:abc',
		]);
		expect(buildBlockHeadingItems(group('dom:xyz', 'unknown', [cluster({})]))).toEqual([
			'dom:xyz',
		]);
	});
});
