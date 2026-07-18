import type { Resource } from '../../../utils/types/types.js';
import type { Knex } from 'knex';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';
import { createWriteRefCaches } from '../_shared/create-write-ref-caches.js';

import { insertResource } from './insert-resource.js';

/**
 * Builds a beholder `Resource` for a failed sub-resource fetch: `status`
 * and `statusText` are `null` and `isError` is `true`, matching what
 * `@d-zero/beholder` reports when the underlying network request never
 * got a response (timeout, DNS failure, connection reset, ...).
 * @param url - The resource URL.
 */
function makeFailedResource(url: string): Resource {
	return {
		url: parseUrl(url)!,
		isExternal: false,
		isError: true,
		status: null,
		statusText: null,
		contentType: null,
		contentLength: null,
		compress: false,
		cdn: false,
		headers: null,
	};
}

/**
 * Builds a beholder `Resource` for a successful sub-resource fetch.
 * @param url - The resource URL.
 */
function makeSuccessfulResource(url: string): Resource {
	return {
		url: parseUrl(url)!,
		isExternal: false,
		isError: false,
		status: 200,
		statusText: 'OK',
		contentType: 'image/png',
		contentLength: 1234,
		compress: false,
		cdn: false,
		headers: { 'content-type': 'image/png' },
	};
}

describe('insertResource', () => {
	let db: Knex;

	beforeEach(async () => {
		db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		await db.raw('PRAGMA foreign_keys = ON');
		await createRefTables(db);
		await createEntityTables(db);
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('inserts a fresh row for a URL seen for the first time', async () => {
		const caches = createWriteRefCaches();
		await insertResource(db, caches, makeSuccessfulResource('https://example.com/a.png'));
		const [row] = await db('resource_items').select('status', 'content_type_id');
		expect(row?.status).toBe(200);
	});

	it('upgrades a previously-failed resource when a later fetch succeeds', async () => {
		// A resource first observed as a network failure (status=null) must
		// not stay frozen that way forever — `--retry-failed` re-renders
		// the referencing page and re-fetches the same resource, and a
		// success this time is strictly more informative than the earlier
		// failure, so it should replace it.
		const caches = createWriteRefCaches();
		const url = 'https://example.com/flaky.png';
		await insertResource(db, caches, makeFailedResource(url));
		const [beforeRow] = await db('resource_items').select('status');
		expect(beforeRow?.status).toBeNull();

		await insertResource(db, caches, makeSuccessfulResource(url));
		const rows = await db('resource_items').select('status', 'content_type_id');
		expect(rows).toHaveLength(1);
		expect(rows[0]?.status).toBe(200);
	});

	it('does not downgrade an already-successful resource when a later fetch fails', async () => {
		// The inverse must also hold: a transient failure on a resource
		// that was already recorded with a real response must not erase
		// that data — only null → non-null is an upgrade.
		const caches = createWriteRefCaches();
		const url = 'https://example.com/stable.png';
		await insertResource(db, caches, makeSuccessfulResource(url));
		await insertResource(db, caches, makeFailedResource(url));
		const [row] = await db('resource_items').select('status');
		expect(row?.status).toBe(200);
	});

	it('leaves a resource untouched when both observations are failures', async () => {
		const caches = createWriteRefCaches();
		const url = 'https://example.com/always-down.png';
		await insertResource(db, caches, makeFailedResource(url));
		await insertResource(db, caches, makeFailedResource(url));
		const rows = await db('resource_items').select('status');
		expect(rows).toHaveLength(1);
		expect(rows[0]?.status).toBeNull();
	});

	it('keeps the original source label on an upgrade (identity/provenance unaffected)', async () => {
		const caches = createWriteRefCaches();
		const url = 'https://example.com/flaky-with-source.png';
		await insertResource(db, caches, makeFailedResource(url), 'inventory-seed');
		await insertResource(db, caches, makeSuccessfulResource(url), 'crawled');
		const [row] = await db('resource_items').select('status', 'source');
		expect(row?.status).toBe(200);
		expect(row?.source).toBe('inventory-seed');
	});
});
