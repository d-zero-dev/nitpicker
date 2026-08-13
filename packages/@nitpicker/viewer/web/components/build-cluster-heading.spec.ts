import type {
	TemplateClusterReasonSummary,
	TemplateClusterSummary,
} from '@nitpicker/query';

import { describe, expect, it } from 'vitest';

import { buildClusterHeading } from './build-cluster-heading.js';

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
	pageCount: 10,
	commonDirectories: [],
	commonStylesheetUrls: [],
	commonStylesheetFileNames: [],
	reason: null,
};

describe('buildClusterHeading', () => {
	it('prefers distinctive stylesheet filenames when present', () => {
		const cluster: TemplateClusterSummary = {
			...baseCluster,
			reason: { ...baseReason, distinctiveStylesheetFileNames: ['product.css'] },
		};
		expect(buildClusterHeading(cluster)).toEqual({
			heading: 'product.css',
			source: 'distinctive',
		});
	});

	it('disambiguates distinctive filenames with the top directory when siblings exist', () => {
		const cluster: TemplateClusterSummary = {
			...baseCluster,
			commonDirectories: [{ directory: '/products/', pageCount: 5 }],
			reason: {
				...baseReason,
				distinctiveStylesheetFileNames: ['product.css'],
				siblingClusterKeys: ['["css:other","cluster:1"]'],
			},
		};
		expect(buildClusterHeading(cluster)).toEqual({
			heading: 'product.css — /products/',
			source: 'distinctive',
		});
	});

	it('does not disambiguate when siblings exist but no common directories are known', () => {
		const cluster: TemplateClusterSummary = {
			...baseCluster,
			reason: {
				...baseReason,
				distinctiveStylesheetFileNames: ['product.css'],
				siblingClusterKeys: ['["css:other","cluster:1"]'],
			},
		};
		expect(buildClusterHeading(cluster)).toEqual({
			heading: 'product.css',
			source: 'distinctive',
		});
	});

	it('falls back to common stylesheet filenames when no reason evidence is distinctive', () => {
		const cluster: TemplateClusterSummary = {
			...baseCluster,
			commonStylesheetFileNames: ['shared.css'],
			reason: baseReason,
		};
		expect(buildClusterHeading(cluster)).toEqual({
			heading: 'shared.css',
			source: 'common',
		});
	});

	it('falls back to the top directories when no stylesheet names are known', () => {
		const cluster: TemplateClusterSummary = {
			...baseCluster,
			commonDirectories: [
				{ directory: '/blog/', pageCount: 8 },
				{ directory: '/news/', pageCount: 2 },
			],
		};
		expect(buildClusterHeading(cluster)).toEqual({
			heading: '/blog/, /news/',
			source: 'directory',
		});
	});

	it('falls back to the raw template key when nothing else yields a heading', () => {
		expect(buildClusterHeading(baseCluster)).toEqual({
			heading: baseCluster.templateKey,
			source: 'raw',
		});
	});
});
