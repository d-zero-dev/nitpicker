import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createViewerReadModelTables } from '../viewer-read-model/create-viewer-read-model-tables.js';

import { streamResourceGroups } from './stream-resource-groups.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_stream_resource_groups__');

/**
 * Drains every {@link streamResourceGroups} chunk into a single flat array.
 * @param accessor - The archive accessor to query.
 * @param chunkSize - Forwarded to {@link streamResourceGroups}.
 * @returns All chunks' rows, concatenated in scan order.
 */
async function collect(
	accessor: Parameters<typeof streamResourceGroups>[0],
	chunkSize?: number,
) {
	const rows = [];
	for await (const chunk of streamResourceGroups(accessor, chunkSize)) {
		rows.push(...chunk);
	}
	return rows;
}

describe('streamResourceGroups', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'stream-resource-groups-test.nitpicker',
	);

	beforeAll(async () => {
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig({
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
		});

		await archive.getKnex().transaction((trx) => createViewerReadModelTables(trx));
		await archive
			.getKnex()('viewer_resource_groups')
			.insert([
				{
					canonical_url: 'https://example.com/a.js',
					status: 200,
					status_text: 'OK',
					content_type: 'application/javascript',
					content_length_min: 100,
					content_length_max: 100,
					count: 1,
					referrer_count: 1,
					referrer_note: 'https://example.com/',
					query_pattern: null,
				},
				{
					canonical_url: 'https://example.com/b.css',
					status: 200,
					status_text: 'OK',
					content_type: 'text/css',
					content_length_min: 50,
					content_length_max: 200,
					count: 3,
					referrer_count: 2,
					referrer_note: 'https://example.com/\nhttps://example.com/about',
					query_pattern: 'v=2',
				},
			]);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('lists every group', async () => {
		const rows = await collect(archive);
		expect(rows).toHaveLength(2);
	});

	it('carries the display fields verbatim', async () => {
		const rows = await collect(archive);
		const row = rows.find((r) => r.canonicalUrl === 'https://example.com/b.css')!;
		expect(row).toMatchObject({
			status: 200,
			statusText: 'OK',
			contentType: 'text/css',
			contentLengthMin: 50,
			contentLengthMax: 200,
			count: 3,
			referrerCount: 2,
			queryPattern: 'v=2',
		});
	});

	it('is independent of chunk size', async () => {
		const baseline = await collect(archive);
		const chunked = await collect(archive, 1);
		const byUrl = (rows: typeof baseline) =>
			rows.toSorted((a, b) => a.canonicalUrl.localeCompare(b.canonicalUrl));
		expect(byUrl(chunked)).toEqual(byUrl(baseline));
	});

	it('throws on a non-positive chunkSize instead of hanging forever', async () => {
		await expect(collect(archive, 0)).rejects.toThrow(RangeError);
		await expect(collect(archive, -1)).rejects.toThrow(RangeError);
	});
});
