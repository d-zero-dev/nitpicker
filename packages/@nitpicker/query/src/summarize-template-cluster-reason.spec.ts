import type { TemplateClusterReason } from '@nitpicker/crawler';

import { describe, it, expect } from 'vitest';

import { summarizeTemplateClusterReason } from './summarize-template-cluster-reason.js';

describe('summarizeTemplateClusterReason', () => {
	it('unions and dedupes distinctiveStylesheetUrls from css blocking entries', () => {
		const reason: TemplateClusterReason = {
			memberCount: 4,
			blocking: [
				{
					blockKey: 'b1',
					reason: { kind: 'css', distinctiveStylesheetHrefs: ['b.css', 'a.css'] },
				},
				{
					blockKey: 'b2',
					reason: { kind: 'css', distinctiveStylesheetHrefs: ['a.css'] },
				},
			],
			structuralCoreTokens: [],
			landmarks: {},
			siblingClusterKeys: [],
		};

		const summary = summarizeTemplateClusterReason(reason);
		expect(summary.distinctiveStylesheetUrls).toEqual(['a.css', 'b.css']);
		expect(summary.distinctiveStylesheetFileNames).toEqual(['a.css', 'b.css']);
	});

	it('produces no distinctive stylesheets for path/orphanMerge blocking', () => {
		const reason: TemplateClusterReason = {
			memberCount: 2,
			blocking: [{ blockKey: 'b1', reason: { kind: 'path', pathKey: 'news' } }],
			structuralCoreTokens: [],
			landmarks: {},
			siblingClusterKeys: [],
		};

		expect(summarizeTemplateClusterReason(reason).distinctiveStylesheetUrls).toEqual([]);
	});

	it('trims structuralCoreTokens to the preview size while keeping the full count', () => {
		const tokens = Array.from({ length: 25 }, (_, i) => `token-${i}`);
		const reason: TemplateClusterReason = {
			memberCount: 1,
			blocking: [],
			structuralCoreTokens: tokens,
			landmarks: {},
			siblingClusterKeys: [],
		};

		const summary = summarizeTemplateClusterReason(reason);
		expect(summary.structuralCoreTokens).toHaveLength(20);
		expect(summary.structuralCoreTokenCount).toBe(25);
	});

	it('orders landmarks in a fixed sequence regardless of input key order', () => {
		const reason: TemplateClusterReason = {
			memberCount: 1,
			blocking: [],
			structuralCoreTokens: [],
			landmarks: {
				nav: {
					presenceRate: 1,
					chromeRate: 1,
					shellTokens: [],
					memberCountWithInstance: 1,
				},
				header: {
					presenceRate: 1,
					chromeRate: 1,
					shellTokens: [],
					memberCountWithInstance: 1,
				},
			},
			siblingClusterKeys: [],
		};

		const summary = summarizeTemplateClusterReason(reason);
		expect(summary.landmarks.map((l) => l.type)).toEqual(['header', 'nav']);
	});

	it('trims each landmark shellTokens to the preview size while keeping the full count', () => {
		const shellTokens = Array.from({ length: 15 }, (_, i) => `shell-${i}`);
		const reason: TemplateClusterReason = {
			memberCount: 1,
			blocking: [],
			structuralCoreTokens: [],
			landmarks: {
				header: {
					presenceRate: 1,
					chromeRate: 1,
					shellTokens,
					memberCountWithInstance: 1,
				},
			},
			siblingClusterKeys: [],
		};

		const summary = summarizeTemplateClusterReason(reason);
		expect(summary.landmarks[0]?.shellTokens).toHaveLength(10);
		expect(summary.landmarks[0]?.shellTokenCount).toBe(15);
	});

	it('carries memberCount through as clusteredMemberCount', () => {
		const reason: TemplateClusterReason = {
			memberCount: 42,
			blocking: [],
			structuralCoreTokens: [],
			landmarks: {},
			siblingClusterKeys: [],
		};

		expect(summarizeTemplateClusterReason(reason).clusteredMemberCount).toBe(42);
	});
});
