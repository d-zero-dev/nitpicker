import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import Archive from '@nitpicker/archive/archive';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { backfillAliasOfId } from './backfill-alias-of-id.js';

// The grouping runs in the native addon; making it throw is the only way to
// reach a failure between reading the candidates and writing the pointers.
vi.mock('@nitpicker/archive/url-alias/group-alias-candidates', () => ({
	groupAliasCandidates: () => {
		throw new RangeError('the addon rejected the candidates');
	},
}));

const dirname = path.dirname(new URL(import.meta.url).pathname);
const workingDir = path.resolve(dirname, '__test_fixtures_backfill_alias_failure__');

const META = {
	lang: 'ja',
	title: 'Same',
	description: null,
	keywords: null,
	noindex: false,
	nofollow: false,
	noarchive: false,
	alternate: null,
	'og:type': null,
	'og:title': null,
	'og:site_name': null,
	'og:description': null,
	'og:url': null,
	'og:image': null,
	'twitter:card': null,
} as const;

describe('backfillAliasOfId when the grouping fails', () => {
	let archive: InstanceType<typeof Archive>;

	beforeEach(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'alias-failure.nitpicker'),
			cwd: workingDir,
		});
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
		for (const url of ['https://example.com/a/index.html', 'https://example.com/a/']) {
			await archive.setPage({
				url: parseUrl(url)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html><body>Same</body></html>',
				meta: META,
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}
	});

	afterEach(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('rejects and leaves the pointers of the previous run in place', async () => {
		const knex = archive.getKnex();
		const [{ minId }] = await knex('content_items').min({ minId: 'id' });
		const [{ maxId }] = await knex('content_items').max({ maxId: 'id' });
		await knex('content_items').where('id', maxId).update({ alias_of_id: minId });

		await expect(backfillAliasOfId(archive)).rejects.toThrow(
			'the addon rejected the candidates',
		);

		const row = await knex('content_items').where('id', maxId).first();
		expect(row.alias_of_id).toBe(minId);
	});
});
