import type { PageData } from '../../../../utils/types/types.js';
import type { Knex } from 'knex';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../../create-adjunct-tables.js';
import { createEntityTables } from '../../../create-entity-tables.js';
import { createRefTables } from '../../../create-ref-tables.js';
import { LibsqlDialect } from '../../../libsql-dialect.js';
import { createWriteRefCaches } from '../../_shared/create-write-ref-caches.js';

import { recordRedirect } from './record-redirect.js';

/**
 * Builds the minimal PageData shape recordRedirect consumes: the URL, its
 * redirect chain, and the external flag. Content fields are irrelevant to
 * the edge-only write path.
 * @param url - The originating URL (start of the redirect chain).
 * @param redirectPaths - The chain hops, ending at the destination.
 * @returns A PageData-compatible object.
 */
function makeRedirectPage(url: string, redirectPaths: string[]): PageData {
	return {
		url: parseUrl(url)!,
		redirectPaths,
		isExternal: false,
		isTarget: true,
		status: 301,
		statusText: 'Moved Permanently',
		contentType: null,
		contentLength: null,
		responseHeaders: {},
		html: '',
		meta: null,
		anchorList: [],
		imageList: [],
		isSkipped: false,
	} as unknown as PageData;
}

describe('recordRedirect', () => {
	let db: Knex;

	beforeEach(async () => {
		db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		await createRefTables(db);
		await createEntityTables(db);
		await createAdjunctTables(db);
	});

	afterEach(async () => {
		await db.destroy();
	});

	it('records the source → destination edge', async () => {
		const caches = createWriteRefCaches();
		await recordRedirect(
			db,
			caches,
			makeRedirectPage('https://example.com/old', [
				'https://example.com/old',
				'https://example.com/new',
			]),
		);
		const rows = await db('content_items as ci')
			.join('url_refs as ur', 'ci.url_id', 'ur.id')
			.select('ur.url as url', 'ci.redirect_dest_id as redirectDestId')
			.orderBy('ci.id');
		const dest = rows.find((r) => r.url === 'https://example.com/new');
		const source = rows.find((r) => r.url === 'https://example.com/old');
		expect(dest?.redirectDestId).toBeNull();
		expect(source?.redirectDestId).toBe(
			(await db('content_items as ci')
				.join('url_refs as ur', 'ci.url_id', 'ur.id')
				.select('ci.id as id')
				.where('ur.url', 'https://example.com/new')
				.first())!.id,
		);
	});

	it('clears the write ref caches when the transaction fails, so a retry cannot reuse rolled-back ids', async () => {
		const caches = createWriteRefCaches();
		// Poison the ground for the transaction: dropping anchor... instead
		// drop `content_items` mid-schema so resolveContentItemId's INSERT
		// throws inside the transaction after url_refs got cached.
		await db.schema.dropTable('content_items');
		await expect(
			recordRedirect(
				db,
				caches,
				makeRedirectPage('https://example.com/old', [
					'https://example.com/old',
					'https://example.com/new',
				]),
			),
		).rejects.toThrow();
		// The guard must have cleared every cache map — a retry with these
		// caches must not observe ids from the failed attempt.
		expect(caches.contentItems.size).toBe(0);
		expect(caches.urlIds.size).toBe(0);
	});
});
