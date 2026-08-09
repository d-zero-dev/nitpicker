import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { backfillDedupeCapEventId } from './backfill-dedupe-cap-event-id.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_backfill_dedupe_cap_event_id__',
);

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

/**
 * Writes a scraped page into the archive via the real write path.
 * @param archive - The archive to write into.
 * @param url - The page URL.
 * @param isExternal - Whether the page is out-of-scope (default false).
 */
async function setPage(
	archive: InstanceType<typeof Archive>,
	url: string,
	isExternal = false,
) {
	await archive.setPage({
		url: parseUrl(url)!,
		redirectPaths: [],
		isExternal,
		isTarget: true,
		status: 200,
		statusText: 'OK',
		contentType: 'text/html',
		contentLength: 100,
		responseHeaders: {},
		html: '<html><body>Page</body></html>',
		meta: { ...baseMeta, title: 'Page' },
		anchorList: [],
		imageList: [],
		isSkipped: false,
	});
}

/**
 * Inserts a queued-but-never-fetched internal page directly (bypassing
 * `setPage`, which always writes `scraped = 1`) — simulates a URL that was
 * discovered and enqueued but never dequeued/fetched, which
 * `backfillDedupeCapEventId` must still be able to mark.
 * @param archive - The archive to write into.
 * @param url - The page URL.
 */
async function insertQueuedPage(archive: InstanceType<typeof Archive>, url: string) {
	const knex = archive.getKnex();
	const [urlRow] = await knex('url_refs').insert({ url }).returning('id');
	await knex('content_items').insert({
		url_id: urlRow.id,
		is_external: 0,
		scraped: 0,
		is_target: 1,
	});
}

/**
 * Records a captured shape via the real `Archive.insertDedupeCapEvent`
 * facade — what `DedupeCapTracker` calls mid-crawl the instant it confirms
 * a same-cluster trap.
 * @param archive - The archive to write into.
 * @param shapeKey - The captured URL shape key.
 * @param detectedAt - Epoch-ms timestamp for `detected_at`.
 * @returns The inserted row's id.
 */
function insertDedupeCapEventRow(
	archive: InstanceType<typeof Archive>,
	shapeKey: string,
	detectedAt: number,
): Promise<number> {
	return archive.insertDedupeCapEvent({
		shapeKey,
		sampleUrl: `https://example.com/sample?shape=${encodeURIComponent(shapeKey)}`,
		bodyHash: Buffer.from('test-body-hash'),
		effectiveThreshold: 8,
		observedCount: 8,
		detectedAt,
	});
}

/**
 * Looks up `content_items.dedupe_cap_event_id` for the given URL.
 * @param archive - The archive to query.
 * @param url - The page URL to look up.
 */
async function getDedupeCapEventId(archive: InstanceType<typeof Archive>, url: string) {
	const knex = archive.getKnex();
	const row = await knex('content_items as ci')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.select('ci.dedupe_cap_event_id as dedupeCapEventId')
		.where('ur.url', url)
		.first();
	return (row?.dedupeCapEventId as number | undefined) ?? null;
}

describe('backfillDedupeCapEventId', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'dedupe-cap-test.nitpicker');

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
	});

	afterEach(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns without throwing or marking anything when dedupe_cap_events is empty', async () => {
		await setPage(archive, 'https://example.com/search/?ssp=1');

		await backfillDedupeCapEventId(archive);

		expect(
			await getDedupeCapEventId(archive, 'https://example.com/search/?ssp=1'),
		).toBeNull();
	});

	it('the deferred FK on dedupe_cap_event_id rejects a reference to a nonexistent event, confirming the empty-events early return needs no reset', async () => {
		// This is what makes the early return above provably safe rather than
		// a "probably fine, dedupe_cap_events is append-only" assumption: with
		// zero rows in dedupe_cap_events, no content_items row can hold a
		// non-null dedupe_cap_event_id in the first place.
		await setPage(archive, 'https://example.com/search/?ssp=1');
		const knex = archive.getKnex();

		// A plain `.join().update()` chain silently drops the JOIN when
		// compiled for SQLite (knex has no UPDATE...JOIN support for this
		// dialect); a `whereIn` subquery avoids the join entirely.
		await expect(
			knex('content_items')
				.whereIn(
					'url_id',
					knex('url_refs').select('id').where('url', 'https://example.com/search/?ssp=1'),
				)
				.update({ dedupe_cap_event_id: 999_999 }),
		).rejects.toThrow(/FOREIGN KEY constraint failed/);
	});

	it('marks internal pages matching a captured shape and leaves others untouched', async () => {
		const shapeKey = 'example.com/search/?ssp={v}';
		const eventId = await insertDedupeCapEventRow(archive, shapeKey, 1_700_000_000_000);

		await setPage(archive, 'https://example.com/search/?ssp=1');
		await setPage(archive, 'https://example.com/search/?ssp=2');
		// Different shape (no digit-bearing path segment collapse to match) — must NOT be marked.
		await setPage(archive, 'https://example.com/other/?ssp=1');

		await backfillDedupeCapEventId(archive);

		expect(await getDedupeCapEventId(archive, 'https://example.com/search/?ssp=1')).toBe(
			eventId,
		);
		expect(await getDedupeCapEventId(archive, 'https://example.com/search/?ssp=2')).toBe(
			eventId,
		);
		expect(
			await getDedupeCapEventId(archive, 'https://example.com/other/?ssp=1'),
		).toBeNull();
	});

	it('does not mark external pages even when their URL shape matches', async () => {
		const shapeKey = 'example.com/search/?ssp={v}';
		await insertDedupeCapEventRow(archive, shapeKey, 1_700_000_000_000);

		await setPage(archive, 'https://example.com/search/?ssp=1', true);

		await backfillDedupeCapEventId(archive);

		expect(
			await getDedupeCapEventId(archive, 'https://example.com/search/?ssp=1'),
		).toBeNull();
	});

	it('marks a queued-but-never-scraped page matching a captured shape', async () => {
		const shapeKey = 'example.com/search/?ssp={v}';
		const eventId = await insertDedupeCapEventRow(archive, shapeKey, 1_700_000_000_000);

		await insertQueuedPage(archive, 'https://example.com/search/?ssp=99');

		await backfillDedupeCapEventId(archive);

		expect(await getDedupeCapEventId(archive, 'https://example.com/search/?ssp=99')).toBe(
			eventId,
		);
	});

	it('assigns the highest-id event when the same shape_key was recorded more than once', async () => {
		const shapeKey = 'example.com/search/?ssp={v}';
		await insertDedupeCapEventRow(archive, shapeKey, 1_700_000_000_000);
		const secondEventId = await insertDedupeCapEventRow(
			archive,
			shapeKey,
			1_700_000_001_000,
		);

		await setPage(archive, 'https://example.com/search/?ssp=1');

		await backfillDedupeCapEventId(archive);

		expect(await getDedupeCapEventId(archive, 'https://example.com/search/?ssp=1')).toBe(
			secondEventId,
		);
	});

	it('is idempotent — calling twice produces the same marks', async () => {
		const shapeKey = 'example.com/search/?ssp={v}';
		const eventId = await insertDedupeCapEventRow(archive, shapeKey, 1_700_000_000_000);
		await setPage(archive, 'https://example.com/search/?ssp=1');

		await backfillDedupeCapEventId(archive);
		await backfillDedupeCapEventId(archive);

		expect(await getDedupeCapEventId(archive, 'https://example.com/search/?ssp=1')).toBe(
			eventId,
		);
	});

	it('un-marks a page whose shape does not match any current event, correcting a stale mark', async () => {
		// An event for a shape unrelated to the page under test — non-empty
		// dedupe_cap_events, but nothing here should ever match this page's
		// real shape ('example.com/search/?ssp={v}').
		const unrelatedEventId = await insertDedupeCapEventRow(
			archive,
			'example.com/other-shape/',
			1_700_000_000_000,
		);
		await setPage(archive, 'https://example.com/search/?ssp=1');

		// Directly point the page at the unrelated event, simulating a stale
		// mark inconsistent with the page's actual URL shape (e.g. left over
		// from a since-changed `computeShapeKey` implementation). Setting an
		// existing event's id — never deleting a referenced row — keeps the
		// deferred FK on `dedupe_cap_event_id` satisfied throughout.
		const knex = archive.getKnex();
		// A plain `.join().update()` chain silently drops the JOIN when
		// compiled for SQLite (knex has no UPDATE...JOIN support for this
		// dialect); a `whereIn` subquery avoids the join entirely.
		await knex('content_items')
			.whereIn(
				'url_id',
				knex('url_refs').select('id').where('url', 'https://example.com/search/?ssp=1'),
			)
			.update({ dedupe_cap_event_id: unrelatedEventId });
		expect(await getDedupeCapEventId(archive, 'https://example.com/search/?ssp=1')).toBe(
			unrelatedEventId,
		);

		await backfillDedupeCapEventId(archive);

		expect(
			await getDedupeCapEventId(archive, 'https://example.com/search/?ssp=1'),
		).toBeNull();
	});
});
