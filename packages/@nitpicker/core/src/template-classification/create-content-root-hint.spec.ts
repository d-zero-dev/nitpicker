import { describe, expect, it } from 'vitest';

import { createContentRootHint } from './create-content-root-hint.js';

const none = {
	mainContentNodeName: null,
	mainContentId: null,
	mainContentRole: null,
	mainContentClassList: null,
};

describe('createContentRootHint', () => {
	it('JSDoc の @example と同じ出力を返す', () => {
		expect(
			createContentRootHint({
				mainContentNodeName: 'DIV',
				mainContentId: 'main',
				mainContentRole: null,
				mainContentClassList: ['spc'],
			}),
		).toStrictEqual({ tagName: 'div', id: 'main', classList: ['spc'] });
	});

	it('nodeName を小文字にする', () => {
		expect(createContentRootHint({ ...none, mainContentNodeName: 'MAIN' })).toStrictEqual(
			{
				tagName: 'main',
			},
		);
	});

	it('role だけでもヒントになる', () => {
		expect(createContentRootHint({ ...none, mainContentRole: 'main' })).toStrictEqual({
			role: 'main',
		});
	});

	it('空文字の id / role と空配列の classList は落とす', () => {
		expect(
			createContentRootHint({
				mainContentNodeName: 'section',
				mainContentId: '',
				mainContentRole: '',
				mainContentClassList: [],
			}),
		).toStrictEqual({ tagName: 'section' });
	});

	it('本文要素が検出されていないページ（全列 null）では undefined', () => {
		expect(createContentRootHint(none)).toBeUndefined();
	});

	it('空文字と空配列しか無い場合も undefined（何にも一致しないヒントは渡さない）', () => {
		expect(
			createContentRootHint({
				mainContentNodeName: '',
				mainContentId: '',
				mainContentRole: '',
				mainContentClassList: [],
			}),
		).toBeUndefined();
	});

	it('classList はゲッターを 1 回だけ読む（読むたびに JSON.parse するため）', () => {
		let reads = 0;
		createContentRootHint({
			...none,
			mainContentNodeName: 'div',
			get mainContentClassList() {
				reads++;
				return ['a'];
			},
		});
		expect(reads).toBe(1);
	});
});
