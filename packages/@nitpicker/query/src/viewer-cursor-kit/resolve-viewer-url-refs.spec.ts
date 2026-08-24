import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveViewerUrlRefs } from './resolve-viewer-url-refs.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

describe('resolveViewerUrlRefs', () => {
	const workingDir = path.resolve(__dirname, '__test_fixtures_resolve_viewer_url_refs__');
	const archiveFilePath = path.resolve(
		workingDir,
		'resolve-viewer-url-refs-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		const knex = archive.getKnex();
		await knex.raw(`
			CREATE TABLE viewer_url_refs (
				id integer primary key,
				url text not null unique
			)
		`);
		await knex('viewer_url_refs').insert([
			{ id: 1, url: 'https://example.com/a' },
			{ id: 2, url: 'https://example.com/b' },
		]);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns an empty map for an empty id list without querying', async () => {
		const result = await resolveViewerUrlRefs(archive.getKnex(), []);
		expect(result.size).toBe(0);
	});

	it('resolves ids to their URL strings', async () => {
		const result = await resolveViewerUrlRefs(archive.getKnex(), [1, 2]);
		expect(result.get(1)).toBe('https://example.com/a');
		expect(result.get(2)).toBe('https://example.com/b');
	});

	it('deduplicates repeated ids into a single lookup', async () => {
		const result = await resolveViewerUrlRefs(archive.getKnex(), [1, 1, 1]);
		expect(result.size).toBe(1);
		expect(result.get(1)).toBe('https://example.com/a');
	});

	it('omits ids with no matching row', async () => {
		const result = await resolveViewerUrlRefs(archive.getKnex(), [1, 999]);
		expect(result.has(999)).toBe(false);
		expect(result.get(1)).toBe('https://example.com/a');
	});
});
