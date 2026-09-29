import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import Archive from '../archive.js';
import { seedContentItem } from '../test-utils/seed-content-item.js';

import { concatArchives } from './concat-archives.js';
import { ArchiveConfigConflictError } from './types.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const paths = {
	a: path.resolve(workingDir, 'concat-archives-a.nitpicker'),
	b: path.resolve(workingDir, 'concat-archives-b.nitpicker'),
	out: path.resolve(workingDir, 'concat-archives-out.nitpicker'),
};

afterEach(async () => {
	for (const p of Object.values(paths)) {
		await fs.rm(p, { force: true });
		const dir = path.dirname(p);
		const base = path.basename(p, path.extname(p));
		await fs.rm(path.join(dir, `._nitpicker-${base}`), { recursive: true, force: true });
	}
});

describe('concatArchives', () => {
	it('merges roots as a union and returns per-source results', async () => {
		const a = await Archive.create({ filePath: paths.a, cwd: workingDir });
		await a.setConfig({
			version: '0.13.0',
			name: 'a',
			baseUrl: 'https://a.example.com/',
			roots: ['https://a.example.com/'],
			recursive: true,
			interval: 0,
			image: false,
			fetchExternal: false,
			parallels: 1,
			excludes: [],
			excludeKeywords: [],
			excludeUrls: [],
			maxExcludedDepth: 0,
			retry: 3,
			fromList: false,
			disableQueries: false,
			userAgent: 'test',
			ignoreRobots: false,
			mainContentSelector: null,
		});
		await seedContentItem(a.getKnex(), 'https://a.example.com/');

		const b = await Archive.create({ filePath: paths.b, cwd: workingDir });
		await b.setConfig({
			version: '0.13.0',
			name: 'b',
			baseUrl: 'https://b.example.com/',
			roots: ['https://b.example.com/'],
			recursive: true,
			interval: 0,
			image: false,
			fetchExternal: false,
			parallels: 1,
			excludes: [],
			excludeKeywords: [],
			excludeUrls: [],
			maxExcludedDepth: 0,
			retry: 3,
			fromList: false,
			disableQueries: false,
			userAgent: 'test',
			ignoreRobots: false,
			mainContentSelector: null,
		});
		await seedContentItem(b.getKnex(), 'https://b.example.com/');

		const out = await Archive.create({ filePath: paths.out, cwd: workingDir });

		const result = await concatArchives({
			sources: [
				{ accessor: a, path: paths.a },
				{ accessor: b, path: paths.b },
			],
			destination: out,
			name: 'merged',
		});

		expect(result.config.roots).toEqual([
			'https://a.example.com/',
			'https://b.example.com/',
		]);
		expect(result.sources).toHaveLength(2);
		expect(result.sources[0]!.inserted).toBe(1);
		expect(result.sources[1]!.inserted).toBe(1);
		expect(result.externalInScopeCount).toBe(0);

		await a.releaseHandle();
		await b.releaseHandle();
		await out.releaseHandle();
	});

	it('throws ArchiveConfigConflictError for mismatched disableQueries, before mutating the destination', async () => {
		const a = await Archive.create({ filePath: paths.a, cwd: workingDir });
		await a.setConfig({
			version: '0.13.0',
			name: 'a',
			baseUrl: 'https://a.example.com/',
			roots: ['https://a.example.com/'],
			recursive: true,
			interval: 0,
			image: false,
			fetchExternal: false,
			parallels: 1,
			excludes: [],
			excludeKeywords: [],
			excludeUrls: [],
			maxExcludedDepth: 0,
			retry: 3,
			fromList: false,
			disableQueries: false,
			userAgent: 'test',
			ignoreRobots: false,
			mainContentSelector: null,
		});
		const b = await Archive.create({ filePath: paths.b, cwd: workingDir });
		await b.setConfig({
			version: '0.13.0',
			name: 'b',
			baseUrl: 'https://b.example.com/',
			roots: ['https://b.example.com/'],
			recursive: true,
			interval: 0,
			image: false,
			fetchExternal: false,
			parallels: 1,
			excludes: [],
			excludeKeywords: [],
			excludeUrls: [],
			maxExcludedDepth: 0,
			retry: 3,
			fromList: false,
			disableQueries: true,
			userAgent: 'test',
			ignoreRobots: false,
			mainContentSelector: null,
		});
		const out = await Archive.create({ filePath: paths.out, cwd: workingDir });

		await expect(
			concatArchives({
				sources: [
					{ accessor: a, path: paths.a },
					{ accessor: b, path: paths.b },
				],
				destination: out,
				name: 'merged',
			}),
		).rejects.toBeInstanceOf(ArchiveConfigConflictError);

		const infoRows = await out.getKnex().select('*').from('info');
		expect(infoRows).toHaveLength(0);

		await a.releaseHandle();
		await b.releaseHandle();
		await out.releaseHandle();
	});
});
