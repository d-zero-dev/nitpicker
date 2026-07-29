import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readClusterReasonsByTemplateKey } from './read-cluster-reasons-by-template-key.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

describe('readClusterReasonsByTemplateKey', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_read_cluster_reasons_by_template_key__',
	);
	let archive: InstanceType<typeof Archive>;

	beforeEach(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'test.nitpicker'),
			cwd: workingDir,
		});
	});

	afterEach(async () => {
		await archive.close();
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('page_template_cluster_reasonsテーブルが存在しない場合は空のMapを返す', async () => {
		await archive.getKnex().schema.dropTableIfExists('page_template_cluster_reasons');

		const result = await readClusterReasonsByTemplateKey(archive.getKnex());

		expect(result.size).toBe(0);
	});

	it('テーブルは存在するが0行の場合は空のMapを返す', async () => {
		const result = await readClusterReasonsByTemplateKey(archive.getKnex());

		expect(result.size).toBe(0);
	});

	it('保存済みJSON列をパースしてtemplateKeyごとのClusterReasonを返す', async () => {
		await archive
			.getKnex()('page_template_cluster_reasons')
			.insert({
				template_key: '["css:abc123","cluster:0"]',
				member_count: 2,
				blocking: JSON.stringify([
					{
						blockKey: 'css:abc123',
						reason: {
							kind: 'css',
							distinctiveStylesheetHrefs: ['https://example.com/a.css'],
						},
					},
				]),
				structural_core_tokens: JSON.stringify(['token-a']),
				landmarks: JSON.stringify({
					header: {
						presenceRate: 1,
						chromeRate: 1,
						shellTokens: [],
						memberCountWithInstance: 2,
					},
				}),
				sibling_cluster_keys: JSON.stringify(['["css:abc123","cluster:1"]']),
			});

		const result = await readClusterReasonsByTemplateKey(archive.getKnex());

		expect(result.size).toBe(1);
		const reason = result.get('["css:abc123","cluster:0"]');
		expect(reason).toEqual({
			memberCount: 2,
			blocking: [
				{
					blockKey: 'css:abc123',
					reason: {
						kind: 'css',
						distinctiveStylesheetHrefs: ['https://example.com/a.css'],
					},
				},
			],
			structuralCoreTokens: ['token-a'],
			landmarks: {
				header: {
					presenceRate: 1,
					chromeRate: 1,
					shellTokens: [],
					memberCountWithInstance: 2,
				},
			},
			siblingClusterKeys: ['["css:abc123","cluster:1"]'],
		});
	});
});
