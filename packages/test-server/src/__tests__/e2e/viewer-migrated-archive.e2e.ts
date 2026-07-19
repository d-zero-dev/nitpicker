import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { buildViewerReadModel } from '@nitpicker/query';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');
const fixtureScript = path.resolve(repoRoot, 'scripts', 'generate-pre-0.13-fixture.mjs');
const migrateScript = path.resolve(repoRoot, 'scripts', 'migrate-to-0.13.mjs');

const LEGACY_TABLES = ['pages', 'anchors', 'images', 'resources', 'resources-referrers'];

describe('viewer read path on a migrated archive', () => {
	let workDir: string;
	let archive: Archive | null = null;

	beforeAll(async () => {
		workDir = mkdtempSync(path.join(os.tmpdir(), 'nitpicker-migrated-e2e-'));
		const inputPath = path.resolve(workDir, 'input.nitpicker');
		const outputPath = path.resolve(workDir, 'output.nitpicker');
		// Genuine end-to-end: build a pre-0.13-shaped archive, run the real
		// migration script on it (retarget + legacy drop + FK check), then
		// open the OUTPUT the way the viewer's writable build path does.
		execFileSync('node', [fixtureScript, inputPath], { cwd: repoRoot });
		execFileSync('node', [migrateScript, inputPath, outputPath], { cwd: repoRoot });
		archive = await Archive.open({ filePath: outputPath, cwd: workDir });
		await buildViewerReadModel(archive);
	}, 180_000);

	afterAll(async () => {
		// `releaseHandle` frees the DB handle and lock without re-tarring —
		// the workDir (including the extracted tmpDir) is removed wholesale.
		await archive?.releaseHandle();
		rmSync(workDir, { recursive: true, force: true });
	});

	it('migrated archive はlegacy テーブルを持たない', async () => {
		const knex = archive!.getKnex();
		for (const table of LEGACY_TABLES) {
			const exists = await knex.schema.hasTable(table);
			expect(exists, `expected ${table} to be absent`).toBe(false);
		}
	});

	it('viewer read model が migrated archive の entity テーブルから構築できる', async () => {
		const knex = archive!.getKnex();
		const viewerPages = (await knex('viewer_pages').select('url')) as {
			url: string;
		}[];
		const urls = viewerPages.map((p) => p.url);
		expect(urls).toContain('http://localhost/a');
		expect(urls).toContain('http://localhost/b');
	});

	it('FK retarget を経た adjunct データが読める（page_tags / analysis_violations）', async () => {
		const knex = archive!.getKnex();
		const tags = await knex('page_tags').select('provider', 'externalId');
		expect(tags).toMatchObject([{ provider: 'WordPress', externalId: 'wp' }]);
		const violations = await knex('analysis_violations').select('validator', 'rule');
		expect(violations).toMatchObject([
			{ validator: 'markuplint', rule: 'required-attr' },
		]);
	});

	it('HTML スナップショットが migrated archive から取得できる', async () => {
		// `page_html_ref` was rebuilt (FK retarget) — the hash join to
		// `page_html_blobs` must still resolve the original body.
		const knex = archive!.getKnex();
		const rows = (await knex('page_html_ref')
			.join('page_html_blobs', 'page_html_blobs.hash', 'page_html_ref.hash')
			.select('page_html_blobs.body as body')) as { body: ArrayBuffer }[];
		expect(rows).toHaveLength(1);
		// libsql returns BLOB columns as ArrayBuffer, not Node Buffer.
		expect(Buffer.from(rows[0]!.body).toString()).toContain('<body>A</body>');
	});
});
