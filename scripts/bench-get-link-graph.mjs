#!/usr/bin/env node
/**
 * Baseline: `getLinkGraph` (the live link graph the viewer falls back to
 * when no read model exists) over a whole archive: the node query, the edge
 * query and the in-degree aggregation.
 *
 * Cases:
 *
 * - `all`: no `limit`, every node and edge
 * - `limit-500`: `limit: 500`, the cap the viewer asks for — the 500 most
 *   linked-to pages and the edges among them
 *
 * Metrics: `nodes` and `edges` returned, and `truncated`.
 *
 * USAGE
 * -----
 *
 *     yarn build
 *     node scripts/bench-get-link-graph.mjs <archive.nitpicker> [--case <case>] [--json]
 */

/* eslint-disable import-x/no-extraneous-dependencies */

import { getLinkGraph } from '@nitpicker/query';

import { countInternalPages } from './bench-lib/count-internal-pages.mjs';
import { measureMs } from './bench-lib/measure-ms.mjs';
import { readBenchArguments } from './bench-lib/read-bench-arguments.mjs';
import { reportBenchResult } from './bench-lib/report-bench-result.mjs';
import { withReadOnlyArchive } from './bench-lib/with-read-only-archive.mjs';

/** The `limit` option per case in `BENCH_CASES['get-link-graph']`. */
const OPTIONS = {
	all: {},
	'limit-500': { limit: 500 },
};

const { archive, caseName, json } = readBenchArguments('get-link-graph');

const options = OPTIONS[caseName];
if (options === undefined) {
	throw new Error(`bench-get-link-graph has no options for case "${caseName}"`);
}

await withReadOnlyArchive(archive, async (accessor) => {
	const { ms, value: graph } = await measureMs(() => getLinkGraph(accessor, options));
	await reportBenchResult({
		bench: 'get-link-graph',
		caseName,
		archivePath: archive,
		pageCount: await countInternalPages(accessor.getKnex()),
		timeMs: ms,
		metrics: {
			nodes: graph.nodes.length,
			edges: graph.edges.length,
			truncated: graph.truncated,
		},
		json,
	});
});
