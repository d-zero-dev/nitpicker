import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createViewerReadModelTables } from './create-viewer-read-model-tables.js';
import { getViewerReadModelVersion } from './get-viewer-read-model-version.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_get_viewer_read_model_version__',
);

describe('getViewerReadModelVersion', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'get-version-test.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns null when no read model has been built', async () => {
		expect(await getViewerReadModelVersion(archive)).toBeNull();
	});

	it('returns the persisted schema_version once built', async () => {
		const knex = archive.getKnex();
		await knex.transaction(async (trx) => {
			await createViewerReadModelTables(trx);
			await trx('viewer_read_model_meta').insert({
				id: 1,
				schema_version: 7,
				built_at: 1,
				source_row_count: 0,
			});
		});
		expect(await getViewerReadModelVersion(archive)).toBe(7);
	});
});
