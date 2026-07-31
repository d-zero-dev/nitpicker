import type { Meta } from '@d-zero/beholder';

import { describe, expect, it } from 'vitest';

import { computeMetaSignature } from './compute-meta-signature.js';

/**
 *
 * @param overrides
 */
function buildMeta(overrides: Partial<Meta> = {}): Meta {
	return {
		title: '',
		...overrides,
	} as Meta;
}

describe('computeMetaSignature', () => {
	it('titleとog:*が全て空ならnullを返す', () => {
		const meta = buildMeta({ title: '', og: {} } as Partial<Meta>);
		expect(computeMetaSignature(meta)).toBeNull();
	});

	it('titleがあればsignatureを返す', () => {
		const meta = buildMeta({ title: 'お知らせ' });
		expect(computeMetaSignature(meta)).not.toBeNull();
	});

	it('titleが空でもog:titleがあればsignatureを返す', () => {
		const meta = buildMeta({ title: '', og: { title: 'OG Title' } } as Partial<Meta>);
		expect(computeMetaSignature(meta)).not.toBeNull();
	});

	it('titleが空でもog:urlがあればsignatureを返す', () => {
		const meta = buildMeta({ title: '', og: { url: '/news' } } as Partial<Meta>);
		expect(computeMetaSignature(meta)).not.toBeNull();
	});

	it('同一の4フィールドは同一signatureになる', () => {
		const metaA = buildMeta({
			title: 'お知らせ',
			description: '一覧です',
			og: { title: 'お知らせ', url: '/news' },
		} as Partial<Meta>);
		const metaB = buildMeta({
			title: 'お知らせ',
			description: '一覧です',
			og: { title: 'お知らせ', url: '/news' },
		} as Partial<Meta>);
		expect(computeMetaSignature(metaA)).toBe(computeMetaSignature(metaB));
	});

	it('descriptionだけが異なれば別signatureになる', () => {
		const metaA = buildMeta({ title: 'お知らせ', description: 'A' });
		const metaB = buildMeta({ title: 'お知らせ', description: 'B' });
		expect(computeMetaSignature(metaA)).not.toBe(computeMetaSignature(metaB));
	});

	it('前後の空白は無視する', () => {
		const metaA = buildMeta({ title: 'お知らせ' });
		const metaB = buildMeta({ title: '  お知らせ  ' });
		expect(computeMetaSignature(metaA)).toBe(computeMetaSignature(metaB));
	});
});
