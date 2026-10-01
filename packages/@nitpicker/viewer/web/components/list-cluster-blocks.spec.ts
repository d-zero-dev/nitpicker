import type {
	TemplateClusterReasonSummary,
	TemplateClusterSummary,
} from '@nitpicker/query';

import { describe, expect, it } from 'vitest';

import { listClusterBlocks } from './list-cluster-blocks.js';

/**
 * Builds a cluster summary with the given template key and blocking evidence.
 * @param templateKey - The template key.
 * @param blocking - The reason's blocking evidence, or `undefined` for no reason.
 * @returns The cluster summary.
 */
function cluster(
	templateKey: string,
	blocking?: TemplateClusterReasonSummary['blocking'],
): TemplateClusterSummary {
	return {
		templateKey,
		pageCount: 1,
		commonDirectories: [],
		commonStylesheetUrls: [],
		commonStylesheetFileNames: [],
		reason: blocking
			? {
					clusteredMemberCount: 1,
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

describe('listClusterBlocks', () => {
	it('lists every block in reason.blocking, in order, with the kind the reason states', () => {
		const blocks = listClusterBlocks(
			cluster('["orphan-merge:events","cluster:0"]', [
				{
					blockKey: 'orphan-merge:events',
					reason: { kind: 'orphanMerge', pathKey: 'events' },
				},
				{
					blockKey: 'orphan-merge:interviews',
					reason: { kind: 'orphanMerge', pathKey: 'interviews' },
				},
			]),
		);
		expect(blocks).toEqual([
			{ blockKey: 'orphan-merge:events', kind: 'orphanMerge' },
			{ blockKey: 'orphan-merge:interviews', kind: 'orphanMerge' },
		]);
	});

	it('falls back to the template key block when no reason was captured', () => {
		expect(listClusterBlocks(cluster('["css:abc","cluster:0"]'))).toEqual([
			{ blockKey: 'css:abc', kind: 'css' },
		]);
	});

	it('falls back to the template key block when the reason has no blocking entries', () => {
		expect(listClusterBlocks(cluster('["path:news","cluster:0"]', []))).toEqual([
			{ blockKey: 'path:news', kind: 'path' },
		]);
	});

	it('treats an unparseable template key as its own unknown block', () => {
		expect(listClusterBlocks(cluster('not-json'))).toEqual([
			{ blockKey: 'not-json', kind: 'unknown' },
		]);
	});
});
