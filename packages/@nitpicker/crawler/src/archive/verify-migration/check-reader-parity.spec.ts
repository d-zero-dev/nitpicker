import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setupMigrationDb } from '../populate-entity-tables/test-utils/setup-entities-db.js';

import { checkReaderParity } from './check-reader-parity.js';
import { MigrationVerificationError } from './types.js';

/**
 * Seeds a matching pair of `pages` + `content_items` rows so the reader
 * parity check has non-zero totals to compare on both sides (zero-vs-zero
 * legitimately skips per {@link checkReaderParity}). The row shapes are
 * intentionally minimal — anything the 8 parity checks do not filter on
 * is omitted so the fixture matches the archive-populated invariant
 * (`content_items.id === pages.id`, `url_refs.url === pages.url`).
 * @param db - Knex handle from {@link setupMigrationDb}.
 */
async function seedMatchingRows(db: ReturnType<typeof knex>): Promise<void> {
	await db('pages').insert([
		{
			id: 1,
			url: 'https://example.com/a',
			scraped: 1,
			isTarget: 1,
			isExternal: 0,
			contentType: 'text/html',
			isSkipped: 0,
		},
	]);
	await db('url_refs').insert([{ id: 1, url: 'https://example.com/a' }]);
	await db('content_type_refs').insert([
		{ id: 1, raw: 'text/html', normalized: 'text/html', category: 'html' },
	]);
	await db('content_items').insert([
		{
			id: 1,
			url_id: 1,
			is_external: 0,
			scraped: 1,
			is_target: 1,
			content_type_id: 1,
			is_skipped: 0,
			source: 'crawled',
		},
	]);
}

describe('checkReaderParity', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupMigrationDb();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('passes when legacy and current totals match on every check', async () => {
		await seedMatchingRows(db);
		await expect(checkReaderParity(db)).resolves.toBeUndefined();
	});

	it('passes silently when all pairs are zero-vs-zero (empty archive)', async () => {
		// No rows inserted anywhere. Every check returns 0 on both sides.
		// This must NOT throw — an empty archive is a legitimate migration
		// input, not a parity failure.
		await expect(checkReaderParity(db)).resolves.toBeUndefined();
	});

	it('throws MigrationVerificationError when a check has a legacy row without a current-side counterpart', async () => {
		// Seed only `pages` (and the ref-tables needed for the current-side
		// query to run without SQL errors), NOT `content_items`. The
		// listPages check compares legacy=1 vs current=0.
		await db('pages').insert({
			id: 1,
			url: 'https://example.com/a',
			scraped: 1,
			isTarget: 1,
			isExternal: 0,
			contentType: 'text/html',
			isSkipped: 0,
		});
		await expect(checkReaderParity(db)).rejects.toBeInstanceOf(
			MigrationVerificationError,
		);
	});

	it('exposes the failing check labels in the error context', async () => {
		await db('pages').insert({
			id: 1,
			url: 'https://example.com/a',
			scraped: 1,
			isTarget: 1,
			isExternal: 0,
			contentType: 'text/html',
			isSkipped: 0,
		});
		try {
			await checkReaderParity(db);
			throw new Error('Expected throw');
		} catch (error) {
			expect(error).toBeInstanceOf(MigrationVerificationError);
			const details = (error as MigrationVerificationError).details;
			expect(details.check).toBe('#9 reader parity');
			// The failure entries are packed into `context.failures` as a
			// single semicolon-separated string; assert it names the
			// listPages check so a copy-paste omission of that entry is
			// caught by this regression guard.
			expect(String(details.context?.failures ?? '')).toContain('listPages default');
		}
	});

	it('reports the compared-check count so a silent skip is auditable', async () => {
		// Populate a matched pair so the listPages check has non-zero
		// totals on both sides — then add an EXTRA `pages` row with no
		// matching `content_items` row so listPages mismatches
		// legacy=2 vs current=1. `checkContentItemsCount` (invariant #1)
		// would catch this too in the full verify chain, but this spec
		// exercises only checkReaderParity in isolation.
		await seedMatchingRows(db);
		await db('pages').insert({
			id: 2,
			url: 'https://example.com/b',
			scraped: 1,
			isTarget: 1,
			isExternal: 0,
			contentType: 'text/html',
			isSkipped: 0,
		});
		try {
			await checkReaderParity(db);
			throw new Error('Expected throw');
		} catch (error) {
			expect(error).toBeInstanceOf(MigrationVerificationError);
			const details = (error as MigrationVerificationError).details;
			// `compared_checks` counts only pairs that had at least one
			// non-zero side. Zero-vs-zero pairs are skipped.
			expect(Number(details.context?.compared_checks ?? 0)).toBeGreaterThan(0);
		}
	});
});
