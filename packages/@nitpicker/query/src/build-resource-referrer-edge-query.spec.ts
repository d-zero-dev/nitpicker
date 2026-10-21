import path from 'node:path';

import Archive from '@nitpicker/archive/archive';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildResourceReferrerEdgeQuery } from './build-resource-referrer-edge-query.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

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

describe('buildResourceReferrerEdgeQuery', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_build_resource_referrer_edge_query__',
	);
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(
				workingDir,
				'build-resource-referrer-edge-query-test.nitpicker',
			),
			cwd: workingDir,
		});
		await archive.setConfig(BASE_CONFIG);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	/**
	 * @param sql - A statement as the dialect prints it.
	 * @returns The statement without identifier quotes, so the checks do not depend on the dialect's quote character.
	 */
	const unquoted = (sql: string): string => sql.replaceAll(/["`]/g, '');

	it('reads resource_ref_edges, keeping only edges whose page has content_items and url_refs rows', () => {
		const { sql } = buildResourceReferrerEdgeQuery(archive.getKnex(), [1, 2])
			.select('rre.resource_id')
			.toSQL();
		const text = unquoted(sql);
		expect(text).toMatch(/from resource_ref_edges as rre/);
		expect(text).toMatch(/inner join content_items as ci on ci\.id = rre\.page_id/);
		expect(text).toMatch(/inner join url_refs as ur on ur\.id = ci\.url_id/);
	});

	it('restricts the edges to the given resource ids', () => {
		const { sql, bindings } = buildResourceReferrerEdgeQuery(archive.getKnex(), [7, 8, 9])
			.select('rre.resource_id')
			.toSQL();
		expect(unquoted(sql)).toMatch(/where rre\.resource_id in \(\?, \?, \?\)/);
		expect(bindings).toEqual([7, 8, 9]);
	});
});
