import type {
	TemplateClusterReasonSummary,
	TemplateClusterSummary,
} from '@nitpicker/query';

import { describe, expect, it } from 'vitest';

import { buildClusterHeadingParts } from './build-cluster-heading-parts.js';

const baseReason: TemplateClusterReasonSummary = {
	clusteredMemberCount: 10,
	blocking: [],
	distinctiveStylesheetUrls: [],
	distinctiveStylesheetFileNames: [],
	structuralCoreTokens: [],
	structuralCoreTokenCount: 0,
	landmarks: [],
	siblingClusterKeys: [],
};

const baseCluster: TemplateClusterSummary = {
	templateKey: '["css:166e4235afcb8b15","cluster:0"]',
	label: null,
	pageCount: 10,
	commonDirectories: [],
	commonStylesheetUrls: [],
	commonStylesheetFileNames: [],
	reason: null,
};

describe('buildClusterHeadingParts', () => {
	it('returns each distinctive stylesheet file name as its own identifier', () => {
		const cluster: TemplateClusterSummary = {
			...baseCluster,
			reason: {
				...baseReason,
				distinctiveStylesheetFileNames: ['product.css', 'slick.css'],
			},
		};
		expect(buildClusterHeadingParts(cluster)).toEqual({
			identifiers: ['product.css', 'slick.css'],
			qualifier: undefined,
			source: 'distinctive',
		});
	});

	it('keeps the top directory as a separate qualifier when siblings exist', () => {
		const cluster: TemplateClusterSummary = {
			...baseCluster,
			commonDirectories: [{ directory: '/products/', pageCount: 5 }],
			reason: {
				...baseReason,
				distinctiveStylesheetFileNames: ['product.css'],
				siblingClusterKeys: ['["css:other","cluster:1"]'],
			},
		};
		expect(buildClusterHeadingParts(cluster)).toEqual({
			identifiers: ['product.css'],
			qualifier: '/products/',
			source: 'distinctive',
		});
	});

	it('falls back to common stylesheet file names, then directories, then the raw key', () => {
		expect(
			buildClusterHeadingParts({
				...baseCluster,
				commonStylesheetFileNames: ['site.css'],
			}).identifiers,
		).toEqual(['site.css']);
		expect(
			buildClusterHeadingParts({
				...baseCluster,
				commonDirectories: [
					{ directory: '/a/', pageCount: 6 },
					{ directory: '/b/', pageCount: 4 },
				],
			}),
		).toEqual({ identifiers: ['/a/', '/b/'], source: 'directory' });
		expect(buildClusterHeadingParts(baseCluster)).toEqual({
			identifiers: [baseCluster.templateKey],
			source: 'raw',
		});
	});
});
