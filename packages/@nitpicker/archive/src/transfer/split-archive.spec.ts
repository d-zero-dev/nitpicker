import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import Archive from '../archive.js';
import { seedContentItem } from '../test-utils/seed-content-item.js';

import { splitArchive } from './split-archive.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const paths = {
	source: path.resolve(workingDir, 'split-archive-source.nitpicker'),
	out: path.resolve(workingDir, 'split-archive-out.nitpicker'),
};

afterEach(async () => {
	for (const p of Object.values(paths)) {
		await fs.rm(p, { force: true });
		const dir = path.dirname(p);
		const base = path.basename(p, path.extname(p));
		await fs.rm(path.join(dir, `._nitpicker-${base}`), { recursive: true, force: true });
	}
});

describe('splitArchive', () => {
	it('extracts the given scope and derives roots from the scope URLs', async () => {
		const source = await Archive.create({ filePath: paths.source, cwd: workingDir });
		await source.setConfig({
			version: '0.13.0',
			name: 'site',
			baseUrl: 'https://example.com/',
			roots: ['https://example.com/'],
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
		await seedContentItem(source.getKnex(), 'https://example.com/blog/');
		await seedContentItem(source.getKnex(), 'https://example.com/about');

		const out = await Archive.create({ filePath: paths.out, cwd: workingDir });

		const result = await splitArchive({
			source: { accessor: source, path: paths.source },
			scopeUrls: ['https://example.com/blog/'],
			destination: out,
			name: 'blog',
		});

		expect(result.config.roots).toEqual(['https://example.com/blog/']);
		expect(result.source.inserted).toBe(1);
		expect(result.source.dropped).toBe(1);

		await source.releaseHandle();
		await out.releaseHandle();
	});

	it('rejects a fromList source', async () => {
		const source = await Archive.create({ filePath: paths.source, cwd: workingDir });
		await source.setConfig({
			version: '0.13.0',
			name: 'site',
			baseUrl: 'https://example.com/a',
			roots: ['https://example.com/a', 'https://example.com/b'],
			recursive: false,
			interval: 0,
			image: false,
			fetchExternal: false,
			parallels: 1,
			excludes: [],
			excludeKeywords: [],
			excludeUrls: [],
			maxExcludedDepth: 0,
			retry: 3,
			fromList: true,
			disableQueries: false,
			userAgent: 'test',
			ignoreRobots: false,
			mainContentSelector: null,
		});
		const out = await Archive.create({ filePath: paths.out, cwd: workingDir });

		await expect(
			splitArchive({
				source: { accessor: source, path: paths.source },
				scopeUrls: ['https://example.com/a'],
				destination: out,
				name: 'blog',
			}),
		).rejects.toThrow(/--list/);

		await source.releaseHandle();
		await out.releaseHandle();
	});

	it('throws when the scope matches nothing in the source', async () => {
		const source = await Archive.create({ filePath: paths.source, cwd: workingDir });
		await source.setConfig({
			version: '0.13.0',
			name: 'site',
			baseUrl: 'https://example.com/',
			roots: ['https://example.com/'],
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
		await seedContentItem(source.getKnex(), 'https://example.com/about');
		const out = await Archive.create({ filePath: paths.out, cwd: workingDir });

		await expect(
			splitArchive({
				source: { accessor: source, path: paths.source },
				scopeUrls: ['https://example.com/nonexistent/'],
				destination: out,
				name: 'nope',
			}),
		).rejects.toThrow(/nothing to extract/);

		await source.releaseHandle();
		await out.releaseHandle();
	});
});
