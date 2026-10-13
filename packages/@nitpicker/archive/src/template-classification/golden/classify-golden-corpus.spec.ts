import { describe, expect, it } from 'vitest';

import { classifyGoldenCorpus } from './classify-golden-corpus.js';

const ARTICLE = '<body><main><article><h1>t</h1><p>x</p></article></main></body>';
const FORM =
	'<body><main><form><label>n</label><input><button>b</button></form></main></body>';

describe('classifyGoldenCorpus', () => {
	it('テンプレートキーを初出順に番号付けし、ページごとにその番号を持つ', async () => {
		const record = await classifyGoldenCorpus([
			{ paths: ['news', '1'], stylesheetHrefs: [], html: ARTICLE },
			{ paths: ['contact'], stylesheetHrefs: [], html: FORM },
			{ paths: ['news', '2'], stylesheetHrefs: [], html: ARTICLE },
		]);

		expect(record.pageCount).toBe(3);
		expect(record.templateKeys).toEqual([
			'["path:news","cluster:0"]',
			'["path:contact","cluster:0"]',
		]);
		expect(record.templateKeyIndexByPage).toEqual([0, 1, 0]);
	});

	it('reason はテンプレートキーの code-unit 順に並び、保存される JSON 文字列で持つ', async () => {
		const record = await classifyGoldenCorpus([
			{ paths: ['news', '1'], stylesheetHrefs: [], html: ARTICLE },
			{ paths: ['contact'], stylesheetHrefs: [], html: FORM },
		]);

		expect(Object.keys(record.clusterReasonJsonByTemplateKey)).toEqual([
			'["path:contact","cluster:0"]',
			'["path:news","cluster:0"]',
		]);
		const news = JSON.parse(
			record.clusterReasonJsonByTemplateKey['["path:news","cluster:0"]'] ?? '',
		) as { memberCount: number };
		expect(news.memberCount).toBe(1);
	});

	it('入力が 1 文字でも変われば inputDigest が変わる', async () => {
		const a = await classifyGoldenCorpus([
			{ paths: ['a'], stylesheetHrefs: [], html: ARTICLE },
		]);
		const b = await classifyGoldenCorpus([
			{ paths: ['b'], stylesheetHrefs: [], html: ARTICLE },
		]);

		expect(a.inputDigest).toMatch(/^[\da-f]{64}$/);
		expect(a.inputDigest).not.toBe(b.inputDigest);
	});
});
