#!/usr/bin/env node
/**
 * End-to-end bench of every backend query the viewer hits, measured against
 * a real `.nitpicker` archive. Outputs a wall-clock-sorted summary so the
 * biggest offenders surface to the top — the candidates for indexing.
 *
 * USAGE
 * -----
 *
 *     node scripts/bench-all-queries.mjs <archive.nitpicker | stub-dir>
 *
 * Output is anonymous (timings only); rows / URLs are not dumped.
 */

/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import path from 'node:path';
import process from 'node:process';

import {
	ArchiveManager,
	checkHeaders,
	findDuplicates,
	findMismatches,
	getErrorKinds,
	getLinkGraph,
	getSummary,
	getViolations,
	listImages,
	listIsolatedClusters,
	listIsolatedPages,
	listLinks,
	listPageLinks,
	listPages,
	listResources,
	listUnusedResources,
} from '@nitpicker/query';

const archivePath = process.argv[2];
if (!archivePath) {
	console.error(
		'Usage: node scripts/bench-all-queries.mjs <archive.nitpicker | stub-dir>',
	);
	process.exit(1);
}

const resolved = path.resolve(archivePath);
console.log(`Bench against ${resolved}\n`);

const openStart = process.hrtime.bigint();
const manager = new ArchiveManager();
const opened = await manager.open(resolved);
const openMs = Number(process.hrtime.bigint() - openStart) / 1e6;
const accessor = opened.accessor;
console.log(`archive open: ${openMs.toFixed(0)}ms (this is the viewer startup cost)\n`);

const knex = accessor.getKnex();
const pageStats = await knex('pages').count('id as total');
const pageCount = Number(pageStats[0]?.total ?? 0);
console.log(`pages: ${pageCount.toLocaleString()} rows\n`);

const cases = [
	['getSummary', () => getSummary(accessor)],
	['getErrorKinds', () => getErrorKinds(accessor)],
	['findDuplicates(field:title)', () => findDuplicates(accessor, 'title')],
	['findMismatches', () => findMismatches(accessor)],
	['getViolations', () => getViolations(accessor, { limit: 100, offset: 0 })],
	['checkHeaders', () => checkHeaders(accessor, { limit: 100, offset: 0 })],
	['getLinkGraph', () => getLinkGraph(accessor)],
	['listPages limit100 offset0', () => listPages(accessor, { limit: 100, offset: 0 })],
	[
		'listPages limit100 offset1000',
		() => listPages(accessor, { limit: 100, offset: 1000 }),
	],
	['listPageLinks limit100', () => listPageLinks(accessor, { limit: 100, offset: 0 })],
	[
		'listLinks type:broken limit100',
		() => listLinks(accessor, { type: 'broken', limit: 100, offset: 0 }),
	],
	[
		'listLinks type:external limit100',
		() => listLinks(accessor, { type: 'external', limit: 100, offset: 0 }),
	],
	['listResources limit100', () => listResources(accessor, { limit: 100, offset: 0 })],
	['listImages limit100', () => listImages(accessor, { limit: 100, offset: 0 })],
	[
		'listIsolatedPages limit100',
		() => listIsolatedPages(accessor, { limit: 100, offset: 0 }),
	],
	[
		'listIsolatedClusters limit100',
		() => listIsolatedClusters(accessor, { limit: 100, offset: 0 }),
	],
	[
		'listUnusedResources limit100',
		() => listUnusedResources(accessor, { limit: 100, offset: 0 }),
	],
];

const results = [];
for (const [name, fn] of cases) {
	const start = process.hrtime.bigint();
	try {
		await fn();
		const ms = Number(process.hrtime.bigint() - start) / 1e6;
		results.push({ name, ms, ok: true });
		console.log(`  ${ms.toFixed(0).padStart(7)}ms  ${name}`);
	} catch (error) {
		const ms = Number(process.hrtime.bigint() - start) / 1e6;
		results.push({ name, ms, ok: false, error: String(error?.message ?? error) });
		console.log(
			`  ${ms.toFixed(0).padStart(7)}ms  ${name}  [ERROR: ${error?.message ?? error}]`,
		);
	}
}

await manager.closeAll();

console.log('\n— Sorted by wall-clock, slowest first —');
results.sort((a, b) => b.ms - a.ms);
for (const r of results) {
	const tag = r.ok ? '' : '  [ERROR]';
	console.log(`  ${r.ms.toFixed(0).padStart(7)}ms  ${r.name}${tag}`);
}
console.log('\nDone.');
