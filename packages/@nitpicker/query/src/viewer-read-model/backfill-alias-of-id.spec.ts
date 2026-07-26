import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { backfillAliasOfId } from './backfill-alias-of-id.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_backfill_alias_of_id__');

const baseMeta = {
	lang: 'ja',
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

interface FixturePage {
	url: string;
	title: string;
	canonical?: string | null;
	html?: string;
	isExternal?: boolean;
}

/**
 * Sets up an archive with the given pages via the real write path, so
 * `page_meta.body_hash` / `title_text_id` / `canonical_url_id` are populated
 * exactly as a real crawl would populate them.
 * @param archive - The archive to write into.
 * @param pages - Pages to write.
 */
async function setPages(archive: InstanceType<typeof Archive>, pages: FixturePage[]) {
	for (const p of pages) {
		await archive.setPage({
			url: parseUrl(p.url)!,
			redirectPaths: [],
			isExternal: p.isExternal ?? false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: p.html ?? `<html><body>${p.title}</body></html>`,
			// `canonical` lives under `meta.link.canonical` in the current
			// beholder `Meta` shape (restructured from a flat top-level
			// `canonical` field — see @d-zero/beholder's CHANGELOG), not as a
			// flat `meta.canonical`.
			meta:
				p.canonical == null
					? { ...baseMeta, title: p.title }
					: { ...baseMeta, title: p.title, link: { canonical: p.canonical } },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
	}
}

/**
 * Looks up `content_items.alias_of_id` (resolved to the representative's own
 * URL, or `null`) for the given URL.
 * @param archive - The archive to query.
 * @param url - The page URL to look up.
 */
async function getAliasTargetUrl(archive: InstanceType<typeof Archive>, url: string) {
	const knex = archive.getKnex();
	const row = await knex('content_items as ci')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.leftJoin('content_items as target', 'target.id', 'ci.alias_of_id')
		.leftJoin('url_refs as target_ur', 'target_ur.id', 'target.url_id')
		.select('target_ur.url as targetUrl')
		.where('ur.url', url)
		.first();
	return (row?.targetUrl as string | undefined) ?? null;
}

describe('backfillAliasOfId', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'alias-test.nitpicker');

	beforeEach(async () => {
		const { mkdirSync } = await import('node:fs');
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

		await setPages(archive, [
			// Title mismatch: same Tier A key, but different titles — must NOT merge.
			{ url: 'https://example.com/mismatch/index.html', title: 'Mismatch A' },
			{ url: 'https://example.com/mismatch/', title: 'Mismatch B' },

			// NULL title (empty string never resolves a title_text_id): same
			// Tier A key, but neither has a title — must NOT merge.
			{ url: 'https://example.com/notitle/index.html', title: '' },
			{ url: 'https://example.com/notitle/', title: '' },

			// Tier A merge, no body_hash requirement — bodies deliberately differ.
			{
				url: 'https://example.com/tier-a/index.html',
				title: 'Tier A',
				html: '<html><body>Body One</body></html>',
			},
			{
				url: 'https://example.com/tier-a/',
				title: 'Tier A',
				html: '<html><body>Totally Different Body</body></html>',
			},

			// Tier B: trailing-slash-only difference, body_hash matches — must merge.
			{
				url: 'https://example.com/tier-b-match',
				title: 'Tier B Match',
				html: '<html><body>Shared Body</body></html>',
			},
			{
				url: 'https://example.com/tier-b-match/',
				title: 'Tier B Match',
				html: '<html><body>Shared Body</body></html>',
			},

			// Tier B: trailing-slash-only difference, body_hash differs — must NOT merge.
			{
				url: 'https://example.com/tier-b-mismatch',
				title: 'Tier B Mismatch',
				html: '<html><body>Body X</body></html>',
			},
			{
				url: 'https://example.com/tier-b-mismatch/',
				title: 'Tier B Mismatch',
				html: '<html><body>Body Y</body></html>',
			},

			// canonical priority: the shorter URL would normally win, but the
			// longer one is elected because the shorter one's canonical points at it.
			{ url: 'https://example.com/canon/index.html', title: 'Canon' },
			{
				url: 'https://example.com/canon/',
				title: 'Canon',
				canonical: 'https://example.com/canon/index.html',
			},

			// No in-group canonical resolution: shortest URL wins.
			{ url: 'https://example.com/short/index.html', title: 'Short' },
			{ url: 'https://example.com/short/', title: 'Short' },

			// Equal-length tie-break: both fold to the same Tier A key
			// (`/tie/`) and both raw URLs are the same length (34 chars) —
			// ascending string comparison decides ('h' < 'p').
			{ url: 'https://example.com/tie/index.htm', title: 'Tie' },
			{ url: 'https://example.com/tie/index.php', title: 'Tie' },

			// Transitive chain: P1~P2 via Tier A (index-suffix fold),
			// P2~P3 via Tier B (trailing-slash fold + matching body_hash).
			// P1 and P3 share NEITHER key directly.
			{
				url: 'https://example.com/chain/index.html',
				title: 'Chain',
				html: '<html><body>Chain Body</body></html>',
			},
			{
				url: 'https://example.com/chain/',
				title: 'Chain',
				html: '<html><body>Chain Body</body></html>',
			},
			{
				url: 'https://example.com/chain',
				title: 'Chain',
				html: '<html><body>Chain Body</body></html>',
			},

			// Singleton — no Tier A/B partner at all.
			{ url: 'https://example.com/alone', title: 'Alone' },
		]);
	});

	afterEach(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('does not merge pages whose title differs even with an equivalent URL', async () => {
		await backfillAliasOfId(archive);

		expect(
			await getAliasTargetUrl(archive, 'https://example.com/mismatch/index.html'),
		).toBe(null);
		expect(await getAliasTargetUrl(archive, 'https://example.com/mismatch/')).toBe(null);
	});

	it('does not merge two pages that both lack a title', async () => {
		await backfillAliasOfId(archive);

		expect(
			await getAliasTargetUrl(archive, 'https://example.com/notitle/index.html'),
		).toBe(null);
		expect(await getAliasTargetUrl(archive, 'https://example.com/notitle/')).toBe(null);
	});

	it('merges a Tier A pair regardless of differing body_hash', async () => {
		await backfillAliasOfId(archive);

		const target = await getAliasTargetUrl(
			archive,
			'https://example.com/tier-a/index.html',
		);
		expect(target).toBe('https://example.com/tier-a/');
	});

	it('merges a Tier B pair when body_hash matches', async () => {
		await backfillAliasOfId(archive);

		const target = await getAliasTargetUrl(archive, 'https://example.com/tier-b-match/');
		expect(target).toBe('https://example.com/tier-b-match');
	});

	it('does not merge a Tier B candidate pair when body_hash differs', async () => {
		await backfillAliasOfId(archive);

		expect(
			await getAliasTargetUrl(archive, 'https://example.com/tier-b-mismatch'),
		).toBeNull();
		expect(
			await getAliasTargetUrl(archive, 'https://example.com/tier-b-mismatch/'),
		).toBeNull();
	});

	it('elects the canonical target as representative even when it is the longer URL', async () => {
		await backfillAliasOfId(archive);

		const target = await getAliasTargetUrl(archive, 'https://example.com/canon/');
		expect(target).toBe('https://example.com/canon/index.html');
		// The representative itself has no alias_of_id (it does not point at itself).
		expect(await getAliasTargetUrl(archive, 'https://example.com/canon/index.html')).toBe(
			null,
		);
	});

	it('falls back to the shortest URL when no in-group canonical resolves', async () => {
		await backfillAliasOfId(archive);

		const target = await getAliasTargetUrl(
			archive,
			'https://example.com/short/index.html',
		);
		expect(target).toBe('https://example.com/short/');
	});

	it('breaks a length tie by ascending string comparison', async () => {
		await backfillAliasOfId(archive);

		// Both URLs are 34 characters and fold to the same Tier A key;
		// 'index.htm' < 'index.php' ('h' < 'p') decides the tie.
		const target = await getAliasTargetUrl(archive, 'https://example.com/tie/index.php');
		expect(target).toBe('https://example.com/tie/index.htm');
	});

	it('closes the transitive union of a Tier A edge and a Tier B edge into one group', async () => {
		await backfillAliasOfId(archive);

		// P1 (`/chain/index.html`) ~ P2 (`/chain/`) via Tier A (index-suffix
		// fold); P2 ~ P3 (`/chain`) via Tier B (trailing-slash fold, matching
		// body_hash). P1 and P3 share neither key directly — this proves the
		// union-find closure connects all three into one group rather than
		// leaving P1 stranded in its own Tier-A-only pair.
		const p1Target = await getAliasTargetUrl(
			archive,
			'https://example.com/chain/index.html',
		);
		const p2Target = await getAliasTargetUrl(archive, 'https://example.com/chain/');
		// P3 (`/chain`) is the shortest URL in the group, so it is elected
		// representative and has no alias_of_id of its own.
		const p3Target = await getAliasTargetUrl(archive, 'https://example.com/chain');

		expect(p3Target).toBeNull();
		expect(p1Target).toBe('https://example.com/chain');
		expect(p2Target).toBe('https://example.com/chain');
	});

	it('leaves a singleton page without any alias_of_id', async () => {
		await backfillAliasOfId(archive);

		expect(await getAliasTargetUrl(archive, 'https://example.com/alone')).toBeNull();
	});

	it('is idempotent — a second run produces identical assignments', async () => {
		await backfillAliasOfId(archive);
		const before = await getAliasTargetUrl(
			archive,
			'https://example.com/tier-a/index.html',
		);

		await backfillAliasOfId(archive);
		const after = await getAliasTargetUrl(
			archive,
			'https://example.com/tier-a/index.html',
		);

		expect(after).toBe(before);
	});

	it('excludes external pages from candidacy', async () => {
		const knex = archive.getKnex();
		const row = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id')
			.where('ur.url', 'https://example.com/tier-a/')
			.first();
		await knex('content_items').where('id', row.id).update({ is_external: 1 });

		await backfillAliasOfId(archive);

		expect(
			await getAliasTargetUrl(archive, 'https://example.com/tier-a/index.html'),
		).toBe(null);
	});

	it('excludes redirect-source pages from candidacy', async () => {
		const knex = archive.getKnex();
		const row = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id')
			.where('ur.url', 'https://example.com/tier-a/')
			.first();
		const dest = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id')
			.where('ur.url', 'https://example.com/alone')
			.first();
		await knex('content_items').where('id', row.id).update({ redirect_dest_id: dest.id });

		await backfillAliasOfId(archive);

		expect(
			await getAliasTargetUrl(archive, 'https://example.com/tier-a/index.html'),
		).toBe(null);
	});

	it('reports progress via onProgress', async () => {
		const calls: [number, number][] = [];
		await backfillAliasOfId(archive, (processed, total) => {
			calls.push([processed, total]);
		});

		expect(calls.length).toBeGreaterThan(0);
		const [processed, total] = calls.at(-1)!;
		expect(processed).toBe(total);
		expect(total).toBeGreaterThan(0);
	});

	it('is a no-op (resolves without error) when there are no eligible groups', async () => {
		const { mkdirSync, rmSync: rm } = await import('node:fs');
		const emptyDir = path.resolve(workingDir, 'empty');
		mkdirSync(emptyDir, { recursive: true });
		const emptyArchive = await Archive.create({
			filePath: path.resolve(emptyDir, 'empty.nitpicker'),
			cwd: emptyDir,
		});
		await emptyArchive.setConfig({
			baseUrl: 'https://empty.example.com',
			name: 'empty',
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
			roots: ['https://empty.example.com'],
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

		await expect(backfillAliasOfId(emptyArchive)).resolves.toBeUndefined();

		await emptyArchive.close();
		rm(emptyDir, { recursive: true, force: true });
	});
});

describe('backfillAliasOfId — reacts to newly added pages on rebuild', () => {
	const rebuildWorkingDir = path.resolve(
		__dirname,
		'__test_fixtures_backfill_alias_rebuild__',
	);
	const archiveFilePath = path.resolve(rebuildWorkingDir, 'rebuild-test.nitpicker');
	let archive: InstanceType<typeof Archive>;

	beforeEach(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(rebuildWorkingDir, { recursive: true });

		archive = await Archive.create({ filePath: archiveFilePath, cwd: rebuildWorkingDir });
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
	});

	afterEach(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(rebuildWorkingDir, { recursive: true, force: true });
	});

	it('re-elects the representative when a shorter member joins the group later', async () => {
		// Round 1: only two `/index.{ext}` variants exist (the bare form does
		// not yet). Both fold to the same Tier A key; the shorter of the two
		// (`index.htm`, 10 chars) is elected representative over
		// `index.html` (11 chars).
		await setPages(archive, [
			{ url: 'https://example.com/grow/index.html', title: 'Grow' },
			{ url: 'https://example.com/grow/index.htm', title: 'Grow' },
		]);

		await backfillAliasOfId(archive);
		const firstRun = await getAliasTargetUrl(
			archive,
			'https://example.com/grow/index.html',
		);
		expect(firstRun).toBe('https://example.com/grow/index.htm');

		// Round 2: a later crawl (`--append`) discovers the bare form, the
		// shortest possible member of this group. A full-recompute rebuild
		// must re-elect it as representative — a backfill-only design that
		// never re-examines already-assigned rows could not do this.
		await setPages(archive, [{ url: 'https://example.com/grow/', title: 'Grow' }]);

		await backfillAliasOfId(archive);
		const secondRun = await getAliasTargetUrl(
			archive,
			'https://example.com/grow/index.html',
		);
		expect(secondRun).toBe('https://example.com/grow/');
		// The previous representative now points at the new one instead of
		// being a representative itself.
		expect(await getAliasTargetUrl(archive, 'https://example.com/grow/index.htm')).toBe(
			'https://example.com/grow/',
		);
	});
});
