import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildScopeMap } from '../scope/build-scope-map.js';
import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';
import { seedContentItem } from '../test-utils/seed-content-item.js';

import { transferArchiveRows } from './transfer-archive-rows.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceAFile = path.resolve(workingDir, 'transfer-rows-source-a.sqlite');
const sourceBFile = path.resolve(workingDir, 'transfer-rows-source-b.sqlite');
const destFile = path.resolve(workingDir, 'transfer-rows-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceAFile, { force: true });
	await fs.rm(sourceBFile, { force: true });
	await fs.rm(destFile, { force: true });
});

describe('transferArchiveRows', () => {
	it('concat: merges two sources, richer observation wins a shared URL, page-scoped data survives', async () => {
		const sourceA = await buildFullSchemaTestDb(sourceAFile, {
			roots: ['https://a.example.com/'],
		});
		const aRoot = await seedContentItem(sourceA, 'https://a.example.com/');
		const aPage1 = await seedContentItem(sourceA, 'https://a.example.com/page1');
		const shared = await seedContentItem(sourceA, 'https://example.com/shared', {
			scraped: 1,
			isExternal: 0,
		});
		const [sharedTitle] = await sourceA('text_refs')
			.insert({ hash: Buffer.from('01', 'hex'), text: 'Shared Title From A' })
			.returning('id');
		await sourceA('page_meta').insert({ page_id: shared, title_text_id: sharedTitle.id });
		await sourceA('anchor_edges').insert([
			{ page_id: aRoot, href_page_id: aPage1, count: 1 },
			{ page_id: aRoot, href_page_id: shared, count: 1 },
		]);
		await sourceA.destroy();

		const sourceB = await buildFullSchemaTestDb(sourceBFile, {
			roots: ['https://b.example.com/'],
		});
		const bRoot = await seedContentItem(sourceB, 'https://b.example.com/');
		const sharedInB = await seedContentItem(sourceB, 'https://example.com/shared', {
			scraped: 1,
			isExternal: 1, // only an external HEAD observation in B — must not win
		});
		await sourceB('anchor_edges').insert({
			page_id: bRoot,
			href_page_id: sharedInB,
			count: 1,
		});
		await sourceB.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const destKnex = dest;

		await transferArchiveRows({
			knex: destKnex,
			sourceDbPath: sourceAFile,
			mode: { kind: 'concat' },
			crawlOrderOffset: 0,
			sourceIndex: 0,
		});
		const resultB = await transferArchiveRows({
			knex: destKnex,
			sourceDbPath: sourceBFile,
			mode: { kind: 'concat' },
			crawlOrderOffset: 100,
			sourceIndex: 1,
		});

		// B's shared row lost the conflict (external HEAD vs A's full scrape).
		expect(resultB.inserted).toBe(1); // b.example.com/ only
		expect(resultB.skipped).toBe(1); // shared

		const urls = await destKnex('url_refs').select('url');
		expect(urls.map((u) => u.url).toSorted()).toEqual([
			'https://a.example.com/',
			'https://a.example.com/page1',
			'https://b.example.com/',
			'https://example.com/shared',
		]);

		const sharedRow = await destKnex
			.select('content_items.is_external')
			.from('content_items')
			.join('url_refs', 'url_refs.id', 'content_items.url_id')
			.where('url_refs.url', 'https://example.com/shared')
			.first();
		expect(sharedRow.is_external).toBe(0); // A's internal observation survived

		const sharedMeta = await destKnex
			.select('text_refs.text')
			.from('page_meta')
			.join('content_items', 'content_items.id', 'page_meta.page_id')
			.join('url_refs', 'url_refs.id', 'content_items.url_id')
			.join('text_refs', 'text_refs.id', 'page_meta.title_text_id')
			.where('url_refs.url', 'https://example.com/shared')
			.first();
		expect(sharedMeta.text).toBe('Shared Title From A');

		// Both A's and B's anchors to the shared URL resolved to the SAME
		// destination row (a single content_items row, not two).
		const inboundAnchors = await destKnex('anchor_edges')
			.join('content_items as dest_ci', 'dest_ci.id', 'anchor_edges.href_page_id')
			.join('url_refs', 'url_refs.id', 'dest_ci.url_id')
			.where('url_refs.url', 'https://example.com/shared')
			.count({ count: '*' })
			.first();
		expect(Number(inboundAnchors?.count)).toBe(2);

		await destKnex.destroy();
	});

	it('split: keeps in-scope pages, stubs a referenced out-of-scope page, drops the rest', async () => {
		const source = await buildFullSchemaTestDb(sourceAFile, {
			roots: ['https://example.com/'],
		});
		const blog = await seedContentItem(source, 'https://example.com/blog/');
		const blogPost = await seedContentItem(source, 'https://example.com/blog/post');
		const about = await seedContentItem(source, 'https://example.com/about');
		// Seeded to prove split's `dropped` count includes an unreferenced,
		// out-of-scope page — its id is never referenced again below.
		await seedContentItem(source, 'https://example.com/orphan');
		const [blogTitle] = await source('text_refs')
			.insert({ hash: Buffer.from('01', 'hex'), text: 'Blog Home' })
			.returning('id');
		await source('page_meta').insert({ page_id: blog, title_text_id: blogTitle.id });
		await source('anchor_edges').insert([
			{ page_id: blog, href_page_id: blogPost, count: 1 },
			{ page_id: blog, href_page_id: about, count: 1 },
		]);
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const scope = buildScopeMap(['https://example.com/blog/']);

		const result = await transferArchiveRows({
			knex: dest,
			sourceDbPath: sourceAFile,
			mode: { kind: 'split', scopeMap: scope },
			crawlOrderOffset: 0,
			sourceIndex: 0,
		});

		expect(result.inserted).toBe(2); // blog, blogPost
		expect(result.stubbed).toBe(1); // about
		expect(result.dropped).toBe(1); // orphan

		const urls = await dest('url_refs').select('url');
		expect(urls.map((u) => u.url).toSorted()).toEqual([
			'https://example.com/about',
			'https://example.com/blog/',
			'https://example.com/blog/post',
		]);

		const aboutRow = await dest
			.select('content_items.is_external', 'content_items.is_target')
			.from('content_items')
			.join('url_refs', 'url_refs.id', 'content_items.url_id')
			.where('url_refs.url', 'https://example.com/about')
			.first();
		expect(aboutRow.is_external).toBe(1);
		expect(aboutRow.is_target).toBe(0);
		const aboutMeta = await dest('page_meta')
			.join('content_items', 'content_items.id', 'page_meta.page_id')
			.join('url_refs', 'url_refs.id', 'content_items.url_id')
			.where('url_refs.url', 'https://example.com/about');
		expect(aboutMeta).toHaveLength(0);

		const blogMeta = await dest
			.select('text_refs.text')
			.from('page_meta')
			.join('content_items', 'content_items.id', 'page_meta.page_id')
			.join('url_refs', 'url_refs.id', 'content_items.url_id')
			.join('text_refs', 'text_refs.id', 'page_meta.title_text_id')
			.where('url_refs.url', 'https://example.com/blog/')
			.first();
		expect(blogMeta.text).toBe('Blog Home');

		await dest.destroy();
	});
});
