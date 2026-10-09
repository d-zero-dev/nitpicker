import path from 'node:path';

import Archive from '@nitpicker/archive/archive';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadTemplateClusterLabels } from './load-template-cluster-labels.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

describe('loadTemplateClusterLabels', () => {
	describe('page_template_labelsテーブルが存在しないアーカイブ', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_load_cluster_labels_no_table__',
		);
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({
				filePath: path.resolve(workingDir, 'no-table.nitpicker'),
				cwd: workingDir,
			});
			await archive.getKnex().schema.dropTableIfExists('page_template_labels');
		});

		afterAll(async () => {
			await archive.close();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('空のMapを返す', async () => {
			const result = await loadTemplateClusterLabels(archive.getKnex(), ['template-a']);
			expect(result.size).toBe(0);
		});
	});

	describe('ラベルが保存されたアーカイブ', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_load_cluster_labels_present__',
		);
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({
				filePath: path.resolve(workingDir, 'present.nitpicker'),
				cwd: workingDir,
			});
			await archive
				.getKnex()('page_template_labels')
				.insert([
					{ template_key: 'template-a', section: 'events', ordinal: 2 },
					{ template_key: 'template-b', section: null, ordinal: 1 },
					{ template_key: 'template-other', section: 'news', ordinal: 1 },
				]);
		});

		afterAll(async () => {
			await archive.close();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('要求したキーのラベルだけを返し、sectionのNULLはnullとして読む', async () => {
			const result = await loadTemplateClusterLabels(archive.getKnex(), [
				'template-a',
				'template-b',
				'template-missing',
			]);
			expect([...result]).toEqual([
				['template-a', { section: 'events', ordinal: 2 }],
				['template-b', { section: null, ordinal: 1 }],
			]);
		});

		it('キーが空なら問い合わせずに空のMapを返す', async () => {
			const result = await loadTemplateClusterLabels(archive.getKnex(), []);
			expect(result.size).toBe(0);
		});
	});
});
