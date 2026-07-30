import { describe, it, expect } from 'vitest';

import { isTemplateClusterReason } from './is-template-cluster-reason.js';

const VALID_REASON = {
	memberCount: 2,
	blocking: [
		{
			blockKey: 'css:abc',
			reason: { kind: 'css', distinctiveStylesheetHrefs: ['a.css'] },
		},
		{ blockKey: 'path:news', reason: { kind: 'path', pathKey: 'news' } },
	],
	structuralCoreTokens: ['a'],
	landmarks: {
		header: {
			presenceRate: 1,
			chromeRate: 1,
			shellTokens: [],
			memberCountWithInstance: 1,
		},
	},
	siblingClusterKeys: [],
};

describe('isTemplateClusterReason', () => {
	it('accepts a value matching the current shape', () => {
		expect(isTemplateClusterReason(VALID_REASON)).toBe(true);
	});

	it('rejects null and non-objects', () => {
		expect(isTemplateClusterReason(null)).toBe(false);
		expect(isTemplateClusterReason('reason')).toBe(false);
		expect(isTemplateClusterReason(42)).toBe(false);
	});

	it('rejects a value missing memberCount', () => {
		const rest = {
			blocking: VALID_REASON.blocking,
			structuralCoreTokens: VALID_REASON.structuralCoreTokens,
			landmarks: VALID_REASON.landmarks,
			siblingClusterKeys: VALID_REASON.siblingClusterKeys,
		};
		expect(isTemplateClusterReason(rest)).toBe(false);
	});

	it('rejects a value whose blocking is not an array', () => {
		expect(isTemplateClusterReason({ ...VALID_REASON, blocking: 'nope' })).toBe(false);
	});

	it('rejects a value whose landmarks is not an object', () => {
		expect(isTemplateClusterReason({ ...VALID_REASON, landmarks: null })).toBe(false);
	});

	it('rejects a blocking entry whose reason is missing the kind-specific field', () => {
		expect(
			isTemplateClusterReason({
				...VALID_REASON,
				blocking: [{ blockKey: 'css:abc', reason: { kind: 'css' } }],
			}),
		).toBe(false);
	});

	it('rejects a blocking entry with an unrecognized reason kind', () => {
		expect(
			isTemplateClusterReason({
				...VALID_REASON,
				blocking: [{ blockKey: 'x', reason: { kind: 'unknown-kind' } }],
			}),
		).toBe(false);
	});

	it('rejects a blocking entry missing blockKey', () => {
		expect(
			isTemplateClusterReason({
				...VALID_REASON,
				blocking: [{ reason: { kind: 'path', pathKey: 'news' } }],
			}),
		).toBe(false);
	});

	it('rejects a landmarks value missing a required field', () => {
		expect(
			isTemplateClusterReason({
				...VALID_REASON,
				landmarks: { header: { presenceRate: 1, chromeRate: 1 } },
			}),
		).toBe(false);
	});

	it('rejects a landmarks value whose shellTokens is not an array', () => {
		expect(
			isTemplateClusterReason({
				...VALID_REASON,
				landmarks: {
					header: {
						presenceRate: 1,
						chromeRate: 1,
						shellTokens: 'nope',
						memberCountWithInstance: 1,
					},
				},
			}),
		).toBe(false);
	});

	it('rejects a value whose structuralCoreTokens is not an array', () => {
		expect(
			isTemplateClusterReason({ ...VALID_REASON, structuralCoreTokens: 'nope' }),
		).toBe(false);
	});

	it('rejects a value whose siblingClusterKeys is not an array', () => {
		expect(isTemplateClusterReason({ ...VALID_REASON, siblingClusterKeys: 'nope' })).toBe(
			false,
		);
	});
});
