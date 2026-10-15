#!/usr/bin/env node
/**
 * Baseline: natural URL order (`page2` before `page10`), both ways the
 * codebase computes it.
 *
 * Cases:
 *
 * - `rank-map`: `buildPageNaturalUrlRankMap`, the in-memory sort
 *   viewer-build runs over the Page List's rows (`applyPageListUniverse`;
 *   the `fromList` allow-list viewer-build applies on top is not, so on a
 *   `--list` archive this ranks a few more rows than it does). Loading the
 *   rows is timed separately (`loadMs`) and excluded from `timeMs`. Metric
 *   `pageUrls`: pages ranked.
 * - `all-urls`: `sortArchiveUrls`, which ranks every page and resource URL
 *   that `listPages` / `listExternalLinks` fall back to when an archive has
 *   no read model. Its own reads, de-duplication and the native ranking are
 *   all inside `timeMs`. Metric `distinctUrls`: distinct page and resource
 *   URLs emitted.
 *
 * USAGE
 * -----
 *
 *     yarn build
 *     node scripts/bench-url-natural-sort.mjs <archive.nitpicker> [--case rank-map|all-urls] [--json]
 */

import { applyPageListUniverse } from '../packages/@nitpicker/query/lib/apply-page-list-universe.js';
import { sortArchiveUrls } from '../packages/@nitpicker/query/lib/sort-archive-urls.js';
import { buildPageNaturalUrlRankMap } from '../packages/@nitpicker/query/lib/viewer-read-model/build-page-natural-url-rank-map.js';

import { countInternalPages } from './bench-lib/count-internal-pages.mjs';
import { measureMs } from './bench-lib/measure-ms.mjs';
import { readBenchArguments } from './bench-lib/read-bench-arguments.mjs';
import { reportBenchResult } from './bench-lib/report-bench-result.mjs';
import { withReadOnlyArchive } from './bench-lib/with-read-only-archive.mjs';

const { archive, caseName, json } = readBenchArguments('url-natural-sort');

/**
 * One runner per case in `BENCH_CASES['url-natural-sort']`.
 * @type {Record<string, (accessor: import('@nitpicker/archive/archive-accessor').ArchiveAccessor) => Promise<{ timeMs: number; metrics: Record<string, unknown> }>>}
 */
const RUNNERS = {
	'rank-map': async (accessor) => {
		const loaded = await measureMs(() =>
			accessor
				.getKnex()('content_items as ci')
				.join('url_refs as ur', 'ur.id', 'ci.url_id')
				.modify((qb) => applyPageListUniverse(qb, { alias: 'ci' }))
				.select('ci.id as id', 'ur.url as url'),
		);
		const sorted = await measureMs(() => buildPageNaturalUrlRankMap(loaded.value));
		return {
			timeMs: sorted.ms,
			metrics: { pageUrls: sorted.value.size, loadMs: Math.round(loaded.ms) },
		};
	},
	'all-urls': async (accessor) => {
		let distinctUrls = 0;
		const sorted = await measureMs(() =>
			sortArchiveUrls(accessor, async () => {
				distinctUrls++;
			}),
		);
		return { timeMs: sorted.ms, metrics: { distinctUrls } };
	},
};

await withReadOnlyArchive(archive, async (accessor) => {
	const knex = accessor.getKnex();
	const run = RUNNERS[caseName];
	if (!run) {
		throw new Error(`bench-url-natural-sort has no runner for case "${caseName}"`);
	}
	const { timeMs, metrics } = await run(accessor);
	await reportBenchResult({
		bench: 'url-natural-sort',
		caseName,
		archivePath: archive,
		pageCount: await countInternalPages(knex),
		timeMs,
		metrics,
		json,
	});
});
