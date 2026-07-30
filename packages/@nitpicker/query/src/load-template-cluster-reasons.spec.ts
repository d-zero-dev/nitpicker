import type { TemplateClusterReason } from '@nitpicker/crawler';

import path from 'node:path';
import { zstdCompressSync } from 'node:zlib';

import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadTemplateClusterReasons } from './load-template-cluster-reasons.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

const SAMPLE_REASON: TemplateClusterReason = {
	memberCount: 2,
	blocking: [
		{
			blockKey: 'css:abc',
			reason: { kind: 'css', distinctiveStylesheetHrefs: ['a.css'] },
		},
	],
	structuralCoreTokens: ['body>header'],
	landmarks: {},
	siblingClusterKeys: [],
};

describe('loadTemplateClusterReasons', () => {
	describe('page_template_clustersテーブルが存在しないアーカイブ', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_load_cluster_reasons_no_table__',
		);
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({
				filePath: path.resolve(workingDir, 'no-table.nitpicker'),
				cwd: workingDir,
			});
			await archive.getKnex().schema.dropTableIfExists('page_template_clusters');
		});

		afterAll(async () => {
			await archive.close();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('空のMapを返す', async () => {
			const result = await loadTemplateClusterReasons(archive.getKnex(), ['template-a']);
			expect(result.size).toBe(0);
		});
	});

	describe('理由が保存されたアーカイブ', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_load_cluster_reasons_present__',
		);
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({
				filePath: path.resolve(workingDir, 'present.nitpicker'),
				cwd: workingDir,
			});
			await archive.replacePageTemplates(
				new Map(),
				new Map([['template-a', SAMPLE_REASON]]),
			);
		});

		afterAll(async () => {
			await archive.close();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('保存した理由をtemplateKeyで読み出せる', async () => {
			const result = await loadTemplateClusterReasons(archive.getKnex(), ['template-a']);
			expect(result.get('template-a')).toEqual(SAMPLE_REASON);
		});

		it('templateKeysに含めなかった理由は返さない', async () => {
			const result = await loadTemplateClusterReasons(archive.getKnex(), [
				'template-unknown',
			]);
			expect(result.has('template-a')).toBe(false);
		});

		it('templateKeysが空なら空のMapを返す', async () => {
			const result = await loadTemplateClusterReasons(archive.getKnex(), []);
			expect(result.size).toBe(0);
		});
	});

	describe('壊れた行が混在するアーカイブ（フェイルクローズ挙動）', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_load_cluster_reasons_corrupt__',
		);
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({
				filePath: path.resolve(workingDir, 'corrupt.nitpicker'),
				cwd: workingDir,
			});
			await archive.replacePageTemplates(
				new Map(),
				new Map([['template-a', SAMPLE_REASON]]),
			);

			// A row whose body isn't a valid zstd frame — decodeJsonRef fails
			// closed to null (see its own JSDoc).
			await archive
				.getKnex()('page_template_clusters')
				.insert({
					template_key: 'template-not-zstd',
					member_count: 1,
					reason_json: Buffer.from('not-a-zstd-frame'),
					codec: 'zstd',
					size_raw: 16,
					size_stored: 16,
				});

			// A row that decodes fine but isn't valid JSON.
			const notJson = zstdCompressSync(Buffer.from('not json', 'utf8'));
			await archive.getKnex()('page_template_clusters').insert({
				template_key: 'template-not-json',
				member_count: 1,
				reason_json: notJson,
				codec: 'zstd',
				size_raw: notJson.byteLength,
				size_stored: notJson.byteLength,
			});

			// A row whose JSON parses but doesn't match TemplateClusterReason's shape.
			const wrongShape = zstdCompressSync(Buffer.from('{"unexpected":true}', 'utf8'));
			await archive.getKnex()('page_template_clusters').insert({
				template_key: 'template-wrong-shape',
				member_count: 1,
				reason_json: wrongShape,
				codec: 'zstd',
				size_raw: wrongShape.byteLength,
				size_stored: wrongShape.byteLength,
			});
		});

		afterAll(async () => {
			await archive.close();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('壊れた行をスキップしつつ正常な行は引き続き読み出せる', async () => {
			const result = await loadTemplateClusterReasons(archive.getKnex(), [
				'template-a',
				'template-not-zstd',
				'template-not-json',
				'template-wrong-shape',
			]);
			expect(result.get('template-a')).toEqual(SAMPLE_REASON);
			expect(result.has('template-not-zstd')).toBe(false);
			expect(result.has('template-not-json')).toBe(false);
			expect(result.has('template-wrong-shape')).toBe(false);
			expect(result.size).toBe(1);
		});
	});
});
