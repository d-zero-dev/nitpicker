import knex from 'knex';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { createRefTables } from '../create-ref-tables.js';
import { LibsqlDialect } from '../libsql-dialect.js';

import { populateUrlRefs } from './populate-url-refs.js';
import { countRows } from './test-utils/count-rows.js';

/**
 * Sets up a minimal in-memory archive with the source tables (pages,
 * resources, images) that 0.13-1 scans, plus the 0.13 ref
 * tables. Column set is a strict subset of the real schema — only the
 * columns `populateUrlRefs` looks at.
 * @returns The connected Knex instance; the caller destroys it.
 */
async function setup(): Promise<ReturnType<typeof knex>> {
	const db = knex({
		client: LibsqlDialect,
		connection: { filename: ':memory:' },
		useNullAsDefault: true,
	});
	await db.schema.createTable('pages', (t) => {
		t.increments('id');
		t.string('url').notNullable();
		t.string('canonical').nullable();
		t.string('og_url').nullable();
		t.string('og_image').nullable();
		t.string('icon_href').nullable();
		t.string('appleTouchIcon_href').nullable();
		t.string('amphtml').nullable();
		t.string('manifest').nullable();
		t.string('twitter_image').nullable();
	});
	await db.schema.createTable('resources', (t) => {
		t.increments('id');
		t.string('url').notNullable();
	});
	await db.schema.createTable('images', (t) => {
		t.increments('id');
		t.string('src').nullable();
		t.string('currentSrc').nullable();
	});
	await createRefTables(db);
	return db;
}

describe('populateUrlRefs (url-refs-upsert)', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setup();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('inserts one url_refs row per distinct URL across pages + resources', async () => {
		await db('pages').insert([
			{ url: 'https://example.com/a' },
			{ url: 'https://example.com/b' },
			{ url: 'https://example.com/a' }, // wouldn't happen in real schema (unique), but tests dedup
		]);
		await db('resources').insert([
			{ url: 'https://cdn.example.com/one.js' },
			{ url: 'https://example.com/a' }, // overlaps with pages
		]);
		await populateUrlRefs(db);
		const rows = await db('url_refs').select('url').orderBy('url');
		expect(rows.map((r) => r.url)).toEqual([
			'https://cdn.example.com/one.js',
			'https://example.com/a',
			'https://example.com/b',
		]);
	});

	it('decomposes scheme/host/port/path/query_hash/fragment on insert', async () => {
		await db('pages').insert([{ url: 'https://example.com:8443/foo?q=1#top' }]);
		await populateUrlRefs(db);
		const row = await db('url_refs')
			.where('url', 'https://example.com:8443/foo?q=1#top')
			.first();
		expect(row.scheme).toBe('https');
		expect(row.host).toBe('example.com');
		expect(row.port).toBe(8443);
		expect(row.path).toBe('/foo');
		expect(row.fragment).toBe('top');
		expect(row.query_hash).not.toBeNull();
		expect(Buffer.from(row.query_hash).byteLength).toBe(32);
	});

	it('harvests URL-shaped meta columns from pages', async () => {
		await db('pages').insert([
			{
				url: 'https://example.com/a',
				canonical: 'https://example.com/canonical',
				og_url: 'https://example.com/og',
				og_image: 'https://cdn.example.com/og-image.png',
				icon_href: 'https://example.com/favicon.ico',
				appleTouchIcon_href: 'https://example.com/apple.png',
				amphtml: 'https://example.com/amp',
				manifest: 'https://example.com/manifest.json',
				twitter_image: 'https://example.com/tw.png',
			},
		]);
		await populateUrlRefs(db);
		const rows = await db('url_refs').select('url').orderBy('url');
		expect(rows.map((r) => r.url)).toEqual([
			'https://cdn.example.com/og-image.png',
			'https://example.com/a',
			'https://example.com/amp',
			'https://example.com/apple.png',
			'https://example.com/canonical',
			'https://example.com/favicon.ico',
			'https://example.com/manifest.json',
			'https://example.com/og',
			'https://example.com/tw.png',
		]);
	});

	it('accepts short data: URIs into url_refs and skips large ones', async () => {
		const shortDataUri = 'data:image/svg+xml;base64,PHN2Zy8+'; // ~30 chars
		const longDataUri = 'data:image/png;base64,' + 'A'.repeat(600); // > 512
		await db('images').insert([
			{ src: shortDataUri, currentSrc: null },
			{ src: longDataUri, currentSrc: null },
			{ src: 'https://example.com/img.png', currentSrc: 'https://example.com/img.png' },
		]);
		await populateUrlRefs(db);
		const urlRows = await db('url_refs').select('url');
		const urls = new Set(urlRows.map((r) => r.url));
		expect(urls.has(shortDataUri)).toBe(true);
		expect(urls.has(longDataUri)).toBe(false);
		expect(urls.has('https://example.com/img.png')).toBe(true);
	});

	it('is idempotent (upsert / no dup)', async () => {
		await db('pages').insert([{ url: 'https://example.com/a' }]);
		await populateUrlRefs(db);
		await populateUrlRefs(db);
		expect(await countRows(db, 'url_refs')).toBe(1);
	});

	it('leaves decomposed columns null for unparseable URLs but still stores raw', async () => {
		// Leading colon guarantees WHATWG URL parse failure — no valid scheme.
		const bad = ':::not-a-url';
		await db('pages').insert([{ url: bad }]);
		await populateUrlRefs(db);
		const row = await db('url_refs').where('url', bad).first();
		expect(row).toBeDefined();
		expect(row.scheme).toBeNull();
		expect(row.host).toBeNull();
		expect(row.port).toBeNull();
		expect(row.path).toBeNull();
		expect(row.query_hash).toBeNull();
		expect(row.fragment).toBeNull();
	});

	it('satisfies the acceptance count invariant (>= distinct pages.url + resources.url)', async () => {
		await db('pages').insert([
			{ url: 'https://example.com/a' },
			{ url: 'https://example.com/b' },
		]);
		await db('resources').insert([
			{ url: 'https://cdn.example.com/x.js' },
			{ url: 'https://cdn.example.com/y.css' },
		]);
		await populateUrlRefs(db);
		const totalRefs = await countRows(db, 'url_refs');
		const pagesDistinct = await db('pages').countDistinct<{ n: number }[]>({ n: 'url' });
		const resourcesDistinct = await db('resources').countDistinct<{ n: number }[]>({
			n: 'url',
		});
		expect(totalRefs).toBeGreaterThanOrEqual(
			Number(pagesDistinct[0]!.n) + Number(resourcesDistinct[0]!.n),
		);
	});
});
