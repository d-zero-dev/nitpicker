import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setupMigrationDb } from '../populate-entity-tables/test-utils/setup-entities-db.js';

import { captureRejection } from './capture-rejection.js';
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
	// Two pages + one broken-link destination + one duplicate title +
	// one canonical mismatch + one image + one resource + one
	// resource-referrer + one analysis_violation. Together this exercises
	// EVERY one of the 8 parity checks with non-zero totals on both
	// sides — the zero-vs-zero skip branch in `checkReaderParity` would
	// otherwise silently swallow 5 of the 8 checks (image / resource /
	// broken-link / duplicate-title / canonical-mismatch / violations)
	// and leave the JOIN chains untested.
	await db('pages').insert([
		{
			id: 1,
			url: 'https://example.com/a',
			scraped: 1,
			isTarget: 1,
			isExternal: 0,
			contentType: 'text/html',
			isSkipped: 0,
			title: 'Shared title',
			canonical: 'https://example.com/canon-a',
		},
		{
			id: 2,
			url: 'https://example.com/b',
			scraped: 1,
			isTarget: 1,
			isExternal: 0,
			contentType: 'text/html',
			isSkipped: 0,
			title: 'Shared title',
		},
		{
			id: 3,
			url: 'https://example.com/broken',
			scraped: 1,
			isTarget: 1,
			isExternal: 0,
			status: 404,
			contentType: 'text/html',
			isSkipped: 0,
		},
	]);
	await db('url_refs').insert([
		{ id: 1, url: 'https://example.com/a' },
		{ id: 2, url: 'https://example.com/b' },
		{ id: 3, url: 'https://example.com/broken' },
		{ id: 4, url: 'https://example.com/canon-a' },
	]);
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
		{
			id: 2,
			url_id: 2,
			is_external: 0,
			scraped: 1,
			is_target: 1,
			content_type_id: 1,
			is_skipped: 0,
			source: 'crawled',
		},
		{
			id: 3,
			url_id: 3,
			is_external: 0,
			scraped: 1,
			is_target: 1,
			status: 404,
			content_type_id: 1,
			is_skipped: 0,
			source: 'crawled',
		},
	]);
	// text_refs / page_meta for the duplicate-title + canonical-mismatch checks.
	await db('text_refs').insert([
		{ id: 1, hash: Buffer.from('t1'), text: 'Shared title' },
	]);
	await db('page_meta').insert([
		{ page_id: 1, title_text_id: 1, canonical_url_id: 4 },
		{ page_id: 2, title_text_id: 1 },
	]);
	// anchors → anchor_edges: page 1 links to page 3 (which is broken 404).
	await db('anchors').insert([{ pageId: 1, hrefId: 3, hash: 'a1', textContent: 'go' }]);
	await db('anchor_edges').insert([
		{ page_id: 1, href_page_id: 3, count: 1, first_hash: 'a1' },
	]);
	// images + image_items — parity is total row counts.
	await db('images').insert([
		{
			id: 1,
			pageId: 1,
			src: 'https://example.com/img.png',
			alt: null,
			width: 1,
			height: 1,
			naturalWidth: 1,
			naturalHeight: 1,
			isLazy: 0,
			viewportWidth: 1,
			sourceCode: null,
		},
	]);
	await db('image_items').insert([
		{
			id: 1,
			page_id: 1,
			src_url_id: null,
			current_src_url_id: null,
			src_blob_id: null,
			current_src_blob_id: null,
			alt_text_id: null,
			width: 1,
			height: 1,
			natural_width: 1,
			natural_height: 1,
			is_lazy: 0,
			viewport_width: 1,
			dom_path_text_id: 1,
		},
	]);
	// resources + resource_items — parity is total row counts.
	await db('resources').insert([{ id: 1, url: 'https://cdn.example.com/x.js' }]);
	await db('url_refs').insert([{ id: 5, url: 'https://cdn.example.com/x.js' }]);
	await db('resource_items').insert([
		{
			id: 1,
			url_id: 5,
			is_external: 0,
			source: 'crawled',
			content_type_id: 1,
		},
	]);
	// analysis_violations → getViolations JOIN chain (analysis_violations →
	// pages / content_items → url_refs). Both sides must return 1.
	await db('analysis_violations').insert([
		{ id: 1, page_id: 1, rule: 'test-rule', severity: 'error' },
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
		const error = await captureRejection(checkReaderParity(db));
		expect(error).toBeInstanceOf(MigrationVerificationError);
		const details = (error as MigrationVerificationError).details;
		expect(details.check).toBe('#9 reader parity');
		// The failure entries are packed into `context.failures` as a
		// single semicolon-separated string; assert it names the
		// listPages check so a copy-paste omission of that entry is
		// caught by this regression guard.
		expect(String(details.context?.failures ?? '')).toContain('listPages default');
	});

	it('reports the compared-check count so a silent skip is auditable', async () => {
		// Populate a matched pair so the listPages check has non-zero
		// totals on both sides — then add an EXTRA `pages` row with no
		// matching `content_items` row so listPages mismatches
		// legacy=(seed+1) vs current=(seed). `checkContentItemsCount`
		// (invariant #1) would catch this too in the full verify chain,
		// but this spec exercises only checkReaderParity in isolation.
		await seedMatchingRows(db);
		await db('pages').insert({
			id: 100,
			url: 'https://example.com/extra',
			scraped: 1,
			isTarget: 1,
			isExternal: 0,
			contentType: 'text/html',
			isSkipped: 0,
		});
		const error = await captureRejection(checkReaderParity(db));
		expect(error).toBeInstanceOf(MigrationVerificationError);
		const details = (error as MigrationVerificationError).details;
		// `compared_checks` counts only pairs that had at least one
		// non-zero side. Zero-vs-zero pairs are skipped.
		expect(Number(details.context?.compared_checks ?? 0)).toBeGreaterThan(0);
	});
});
