import fs from 'node:fs/promises';
import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { listInventoryRuns } from './list-inventory-runs.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_list_inventory_runs__');

/**
 * Minimal archive config — listInventoryRuns reads from `inventory_runs`
 * only, so anything beyond what `setConfig` requires is irrelevant.
 * @param fileName
 */
async function buildArchive(fileName: string) {
	await fs.mkdir(workingDir, { recursive: true });
	const archiveFilePath = path.resolve(workingDir, fileName);
	await fs.rm(archiveFilePath, { force: true });
	const archive = await Archive.create({
		filePath: archiveFilePath,
		cwd: workingDir,
	});
	await archive.setConfig({
		baseUrl: 'https://example.com',
		name: 'test',
		version: '0.10.0',
		recursive: true,
		interval: 0,
		image: false,
		fetchExternal: false,
		parallels: 1,
		roots: ['https://example.com'],
		excludes: [],
		excludeKeywords: [],
		excludeUrls: [],
		maxExcludedDepth: 0,
		retry: 3,
		fromList: false,
		disableQueries: false,
		userAgent: 'test',
		ignoreRobots: false,
	});
	return archive;
}

afterAll(async () => {
	await fs.rm(workingDir, { recursive: true, force: true });
});

describe('listInventoryRuns', () => {
	let archive: InstanceType<typeof Archive>;

	beforeEach(async () => {
		archive = await buildArchive(`inventory-runs-${Date.now()}.nitpicker`);
	});

	it('returns rows ordered by `ran_at` DESC (newest first)', async () => {
		// INSERT out of chronological order to prove the helper sorts on
		// `ran_at`, not on insertion order / `id`.
		await archive.recordInventoryRun({
			ran_at: '2026-06-20T00:00:00Z',
			list_label: 'mid',
		});
		await archive.recordInventoryRun({
			ran_at: '2026-06-19T00:00:00Z',
			list_label: 'oldest',
		});
		await archive.recordInventoryRun({
			ran_at: '2026-06-21T00:00:00Z',
			list_label: 'newest',
		});

		const result = await listInventoryRuns(archive);
		expect(result.items.map((r) => r.list_label)).toEqual(['newest', 'mid', 'oldest']);
		expect(result.total).toBe(3);
	});

	it('honours `limit` and `offset` for pagination', async () => {
		await archive.recordInventoryRun({ ran_at: '2026-06-21T00:00:00Z' });
		await archive.recordInventoryRun({ ran_at: '2026-06-20T00:00:00Z' });
		await archive.recordInventoryRun({ ran_at: '2026-06-19T00:00:00Z' });

		const firstPage = await listInventoryRuns(archive, { limit: 2 });
		expect(firstPage.items).toHaveLength(2);
		expect(firstPage.total).toBe(3);

		const secondPage = await listInventoryRuns(archive, { limit: 2, offset: 2 });
		expect(secondPage.items).toHaveLength(1);
		expect(secondPage.total).toBe(3);
	});

	it('returns every column from the row including NULL-by-default fields', async () => {
		await archive.recordInventoryRun({
			ran_at: '2026-06-21T11:30:00+09:00',
			list_label: 'full-fields',
			source_file_sha256: 'c'.repeat(64),
			total_lines: 100,
			new_pages: 10,
			new_resources: 5,
			scope_skipped: 2,
			notes: 'first applied list',
		});

		const result = await listInventoryRuns(archive);
		expect(result.items[0]).toMatchObject({
			ran_at: '2026-06-21T11:30:00+09:00',
			list_label: 'full-fields',
			source_file_sha256: 'c'.repeat(64),
			total_lines: 100,
			new_pages: 10,
			new_resources: 5,
			scope_skipped: 2,
			notes: 'first applied list',
		});
		expect(typeof result.items[0]?.id).toBe('number');
		// Privacy: `source_file_path` is no longer persisted post-Phase-1.
		// Pin the read shape so a regression that reintroduces SELECT of
		// the orphan column on legacy archives gets caught here.
		expect(result.items[0]).not.toHaveProperty('source_file_path');
	});

	it('returns an empty result when `inventory_runs` is missing (Phase 1 pre-migration archive fallback)', async () => {
		// Simulate an archive opened in a context where the migration
		// did not run (read-only stub mode, or a pre-Phase-1 file). The
		// helper MUST tolerate the missing table — clients (`query`
		// CLI, viewer, MCP) call this unconditionally and a thrown
		// "no such table: inventory_runs" would break those flows.
		await archive.getKnex().schema.dropTableIfExists('inventory_runs');
		const result = await listInventoryRuns(archive);
		expect(result.items).toEqual([]);
		expect(result.total).toBe(0);
	});

	it('returns an empty result when the table exists but no runs have been recorded', async () => {
		const result = await listInventoryRuns(archive);
		expect(result.items).toEqual([]);
		expect(result.total).toBe(0);
	});
});
