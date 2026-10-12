#!/usr/bin/env node
/**
 * Baseline: `backfillAliasOfId` (full recompute of
 * `content_items.alias_of_id`: Tier A / Tier B buckets joined by a
 * JavaScript union-find, then the writes).
 *
 * The function writes, so it runs on a throwaway extracted copy of the
 * archive; the source file is never modified. Like viewer-build, it first
 * fills any missing `page_meta.body_hash` (`backfillBodyHashFromHtmlBlobs`,
 * untimed): Tier B buckets by body hash, so on an archive that never went
 * through viewer-build the alias computation would otherwise see no Tier B
 * candidates and do far less than it does in production. Metrics: `aliasedRows`
 * (rows pointing at a representative afterwards) and `writtenRows` (the
 * final progress total), counted outside `timeMs`.
 *
 * USAGE
 * -----
 *
 *     yarn build
 *     node scripts/bench-alias-backfill.mjs <archive.nitpicker> [--json]
 */

/* eslint-disable import-x/no-extraneous-dependencies */

import { backfillAliasOfId, backfillBodyHashFromHtmlBlobs } from '@nitpicker/query';

import { countInternalPages } from './bench-lib/count-internal-pages.mjs';
import { measureMs } from './bench-lib/measure-ms.mjs';
import { readBenchArguments } from './bench-lib/read-bench-arguments.mjs';
import { reportBenchResult } from './bench-lib/report-bench-result.mjs';
import { withWritableArchiveCopy } from './bench-lib/with-writable-archive-copy.mjs';

const { archive, caseName, json } = readBenchArguments('alias-backfill');

await withWritableArchiveCopy(archive, async (writable) => {
	const knex = writable.getKnex();
	await backfillBodyHashFromHtmlBlobs(writable);
	let writtenRows = 0;
	const { ms } = await measureMs(() =>
		backfillAliasOfId(writable, (_processed, total) => {
			writtenRows = total;
		}),
	);
	const [aliased] = await knex('content_items')
		.whereNotNull('alias_of_id')
		.count({ count: '*' });
	await reportBenchResult({
		bench: 'alias-backfill',
		caseName,
		archivePath: archive,
		pageCount: await countInternalPages(knex),
		timeMs: ms,
		metrics: { aliasedRows: Number(aliased.count), writtenRows },
		json,
	});
});
