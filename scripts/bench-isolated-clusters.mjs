#!/usr/bin/env node
/**
 * Baseline: `computeIsolatedClusters` (connected components of the
 * inventory-* subgraph, JavaScript union-find) over a whole archive.
 *
 * `bench-isolated.mjs` decomposes the same computation into its SQL stages
 * and probes indexes; this script only measures the public function, so
 * the union-find port can be compared against it unchanged.
 *
 * Metrics: `candidates` (inventory-* nodes), `anchorRows` (anchor rows read
 * from candidate pages — the edges the union-find walks, before redirect
 * resolution drops the ones leaving the subgraph), `components`. Counted
 * after the timed run, outside `timeMs`, starting from the members the
 * function returned (so the candidate filter is never copied). The anchor
 * count itself re-reads `anchor_edges` for those pages by URL, since the
 * returned members carry no ids; the 2-page smoke fixture has no inventory
 * pages, so that query only runs on a real archive. An archive with no
 * inventory-* pages short-circuits to zero components, and alias sources
 * are excluded from the candidates, so measure an archive whose read model
 * (which fills `alias_of_id`) has been built.
 *
 * USAGE
 * -----
 *
 *     yarn build
 *     node scripts/bench-isolated-clusters.mjs <archive.nitpicker> [--json]
 */

/* eslint-disable import-x/no-extraneous-dependencies */

import { computeIsolatedClusters } from '@nitpicker/query';

import { SQLITE_IN_CHUNK } from '../packages/@nitpicker/query/lib/sqlite-in-chunk.js';

import { countInternalPages } from './bench-lib/count-internal-pages.mjs';
import { measureMs } from './bench-lib/measure-ms.mjs';
import { readBenchArguments } from './bench-lib/read-bench-arguments.mjs';
import { reportBenchResult } from './bench-lib/report-bench-result.mjs';
import { withReadOnlyArchive } from './bench-lib/with-read-only-archive.mjs';

const { archive, caseName, json } = readBenchArguments('isolated-clusters');

await withReadOnlyArchive(archive, async (accessor) => {
	const knex = accessor.getKnex();
	const { ms, value: components } = await measureMs(() =>
		computeIsolatedClusters(accessor),
	);
	const memberUrls = components.flatMap((component) =>
		component.members.map((member) => member.url),
	);
	let anchorRows = 0;
	for (let i = 0; i < memberUrls.length; i += SQLITE_IN_CHUNK) {
		const [row] = await knex('anchor_edges')
			.whereIn(
				'page_id',
				knex('content_items as ci')
					.join('url_refs as ur', 'ur.id', 'ci.url_id')
					.whereIn('ur.url', memberUrls.slice(i, i + SQLITE_IN_CHUNK))
					.select('ci.id'),
			)
			.count({ count: '*' });
		anchorRows += Number(row.count);
	}
	await reportBenchResult({
		bench: 'isolated-clusters',
		caseName,
		archivePath: archive,
		pageCount: await countInternalPages(knex),
		timeMs: ms,
		metrics: {
			candidates: memberUrls.length,
			anchorRows,
			components: components.length,
		},
		json,
	});
});
