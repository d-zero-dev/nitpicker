import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveAliasAndRedirectChain } from './resolve-alias-and-redirect-chain.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_resolve_alias_and_redirect_chain__',
);

const META = {
	lang: null,
	title: null,
	description: null,
	keywords: null,
	noindex: false,
	nofollow: false,
	noarchive: false,
	canonical: null,
	alternate: null,
	'og:type': null,
	'og:title': null,
	'og:site_name': null,
	'og:description': null,
	'og:url': null,
	'og:image': null,
	'twitter:card': null,
};

describe('resolveAliasAndRedirectChain', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'resolve-chain-test.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig({
			baseUrl: 'https://example.com',
			roots: ['https://example.com'],
			name: 'test',
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: true,
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
		});

		// Four plain pages; relationships between them are wired directly via
		// knex below, since a redirect landing on an alias member cannot be
		// produced through the normal write path (backfillAliasOfId is what
		// would compute it, on a real archive, from body/URL signals).
		for (const url of [
			'https://example.com/plain',
			'https://example.com/old',
			'https://example.com/new/index.html',
			'https://example.com/new',
			'https://example.com/a',
			'https://example.com/b',
			'https://example.com/c',
		]) {
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
				html: '<html></html>',
				meta: META,
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	/**
	 * Resolves a fixture URL to its `content_items.id`.
	 * @param url - The URL to resolve.
	 */
	async function idOf(url: string): Promise<number> {
		const row = await archive
			.getKnex()('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id')
			.where('ur.url', url)
			.first();
		return row.id;
	}

	it('returns the starting id unchanged when neither column is set', async () => {
		const knex = archive.getKnex();
		const plainId = await idOf('https://example.com/plain');
		expect(await resolveAliasAndRedirectChain(knex, plainId)).toBe(plainId);
	});

	it('resolves a single redirect hop', async () => {
		const knex = archive.getKnex();
		const oldId = await idOf('https://example.com/old');
		const plainId = await idOf('https://example.com/plain');
		await knex('content_items').where('id', oldId).update({ redirect_dest_id: plainId });

		expect(await resolveAliasAndRedirectChain(knex, oldId)).toBe(plainId);
	});

	it('resolves a single alias hop', async () => {
		const knex = archive.getKnex();
		const memberId = await idOf('https://example.com/new/index.html');
		const repId = await idOf('https://example.com/new');
		await knex('content_items').where('id', memberId).update({ alias_of_id: repId });

		expect(await resolveAliasAndRedirectChain(knex, memberId)).toBe(repId);
	});

	it('resolves a redirect that lands on a non-representative alias member (the confirmed code-review gap)', async () => {
		const knex = archive.getKnex();
		const aId = await idOf('https://example.com/a');
		const bId = await idOf('https://example.com/b');
		const cId = await idOf('https://example.com/c');
		// /a redirects to /b (pre-flattened, as the crawler would write it),
		// and /b is itself merged as an alias member of /c.
		await knex('content_items').where('id', aId).update({ redirect_dest_id: bId });
		await knex('content_items').where('id', bId).update({ alias_of_id: cId });

		expect(await resolveAliasAndRedirectChain(knex, aId)).toBe(cId);
	});

	it('does not loop forever on a cycle', async () => {
		const knex = archive.getKnex();
		const aId = await idOf('https://example.com/a');
		const bId = await idOf('https://example.com/b');
		await knex('content_items').where('id', aId).update({ redirect_dest_id: bId });
		await knex('content_items').where('id', bId).update({ redirect_dest_id: aId });

		// Either id is an acceptable terminal for a malformed cycle — the
		// contract is only "terminates", not which member it lands on.
		const result = await resolveAliasAndRedirectChain(knex, aId);
		expect([aId, bId]).toContain(result);
	});
});
