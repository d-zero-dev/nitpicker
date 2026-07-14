import path from 'node:path';

import { Archive, populateMigrationTables } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ensureViewerReadModel } from './ensure-viewer-read-model.js';
import { hasViewerReadModel } from './has-viewer-read-model.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_ensure_viewer_read_model__');

/** Minimal config — `buildViewerReadModel` now also computes a `getSummary` snapshot, which requires `accessor.getConfig()` to resolve. */
const BASE_CONFIG = {
	baseUrl: 'https://example.com',
	name: 'test',
	version: '0.13.0',
	recursive: true,
	interval: 0,
	image: true,
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
};

describe('ensureViewerReadModel', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'ensure-test.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('builds the read model when missing', async () => {
		expect(await hasViewerReadModel(archive)).toBe(false);
		await ensureViewerReadModel(archive);
		expect(await hasViewerReadModel(archive)).toBe(true);
	});

	it('does not rebuild when already current', async () => {
		// A rebuild always drops-and-recreates viewer_query_profiles, so a
		// marker row inserted here can only survive a no-op call. Asserting
		// on `built_at` instead would be timing-flaky: a real (buggy)
		// rebuild could complete within the same millisecond and produce an
		// identical `Date.now()` value, masking the bug.
		const knex = archive.getKnex();
		await knex('viewer_query_profiles').insert({
			scope: 'marker',
			profile_key: 'marker',
			sort_key: 'x',
			sort_order: 'asc',
			total: 0,
		});

		await ensureViewerReadModel(archive);

		const marker = await knex('viewer_query_profiles')
			.where({ scope: 'marker', profile_key: 'marker' })
			.first();
		expect(marker).toBeDefined();

		await knex('viewer_query_profiles')
			.where({ scope: 'marker', profile_key: 'marker' })
			.del();
	});

	it('rebuilds when the persisted schema_version is stale', async () => {
		// Same marker-row technique as above: a real rebuild always
		// drops-and-recreates viewer_query_profiles, so the marker's absence
		// proves a rebuild ran (timing-independent, unlike comparing
		// `built_at`, which a same-millisecond rebuild could leave unchanged).
		const knex = archive.getKnex();
		await knex('viewer_read_model_meta').where('id', 1).update({ schema_version: 0 });
		await knex('viewer_query_profiles').insert({
			scope: 'marker',
			profile_key: 'marker',
			sort_key: 'x',
			sort_order: 'asc',
			total: 0,
		});

		await ensureViewerReadModel(archive);

		const after = await knex('viewer_read_model_meta').where('id', 1).first();
		expect(after?.schema_version).not.toBe(0);
		const marker = await knex('viewer_query_profiles')
			.where({ scope: 'marker', profile_key: 'marker' })
			.first();
		expect(marker).toBeUndefined();
	});

	it('forwards onProgress to buildViewerReadModel when a build is actually needed', async () => {
		const knex = archive.getKnex();
		// This fixture archive never called setPage(), so `pages` is empty
		// and a rebuild would insert zero rows (onProgress never fires). A
		// bare raw insert gives buildViewerReadModel one row to report
		// progress on without depending on another spec's page fixtures.
		await knex('pages').insert({
			url: 'https://example.com/progress-row',
			scraped: 1,
			isTarget: 1,
		});
		await populateMigrationTables(archive);
		await knex('viewer_read_model_meta').where('id', 1).update({ schema_version: 0 });

		const calls: unknown[] = [];
		await ensureViewerReadModel(archive, { onProgress: (p) => calls.push(p) });

		expect(calls.length).toBeGreaterThan(0);
	});

	it('never invokes onProgress on the already-current no-op path', async () => {
		const calls: unknown[] = [];
		await ensureViewerReadModel(archive, { onProgress: (p) => calls.push(p) });
		expect(calls).toHaveLength(0);
	});

	it('does not throw on a read-only accessor that is already current', async () => {
		const readOnlyAccessor = await Archive.connect(archive.tmpDir);
		try {
			await expect(ensureViewerReadModel(readOnlyAccessor)).resolves.toBeUndefined();
		} finally {
			await readOnlyAccessor.close();
		}
	});

	it('throws on a read-only accessor with no read model', async () => {
		const freshWorkingDir = path.resolve(
			__dirname,
			'__test_fixtures_ensure_viewer_read_model_fresh__',
		);
		const { mkdirSync, rmSync } = await import('node:fs');
		mkdirSync(freshWorkingDir, { recursive: true });
		const freshArchive = await Archive.create({
			filePath: path.resolve(freshWorkingDir, 'fresh.nitpicker'),
			cwd: freshWorkingDir,
		});
		try {
			const readOnlyAccessor = await Archive.connect(freshArchive.tmpDir);
			try {
				await expect(ensureViewerReadModel(readOnlyAccessor)).rejects.toThrow(
					/read-only/i,
				);
			} finally {
				await readOnlyAccessor.close();
			}
		} finally {
			await freshArchive.releaseHandle();
			rmSync(freshWorkingDir, { recursive: true, force: true });
		}
	});
});
