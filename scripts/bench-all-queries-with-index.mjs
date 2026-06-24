#!/usr/bin/env node
/**
 * Same matrix as {@link ./bench-all-queries.mjs} but applies the candidate
 * composite indexes against a temp copy of the archive before re-running.
 * Used to verify which queries the new indexes actually accelerate.
 *
 * USAGE
 * -----
 *
 *     node scripts/bench-all-queries-with-index.mjs <archive.nitpicker>
 */

/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { ArchiveAccessor } from '@nitpicker/crawler';
import {
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
import knex from 'knex';
import * as tar from 'tar';

import { LibsqlDialect } from '../packages/@nitpicker/crawler/lib/archive/libsql-dialect.js';

const archivePath = process.argv[2];
if (!archivePath) {
	console.error(
		'Usage: node scripts/bench-all-queries-with-index.mjs <archive.nitpicker>',
	);
	process.exit(1);
}

const workDir = path.join(tmpdir(), `nitpicker-bench-idx-${process.pid}`);
rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });
console.log(`Untarring to ${workDir} ...`);
await tar.x({ file: path.resolve(archivePath), cwd: workDir });

const innerDirs = readdirSync(workDir, { withFileTypes: true })
	.filter((entry) => entry.isDirectory() && !entry.name.startsWith('._'))
	.map((entry) => entry.name);
const innerDir = path.join(workDir, innerDirs[0]);
const dbPath = path.join(innerDir, 'db.sqlite');
console.log(`DB at ${dbPath}\n`);

const db = knex({
	client: LibsqlDialect,
	connection: { filename: dbPath },
	useNullAsDefault: true,
});

// Spin up an ArchiveAccessor-shaped stub that returns this knex instance.
// `listPages` etc. only touch `accessor.getKnex()`, so a minimal stub
// works for benchmarking purposes.
const accessor = /** @type {ArchiveAccessor} */ ({ getKnex: () => db });

const cases = [
	['getSummary', () => getSummary(accessor)],
	['getErrorKinds', () => getErrorKinds(accessor)],
	['findDuplicates title', () => findDuplicates(accessor, 'title')],
	['findMismatches', () => findMismatches(accessor)],
	['getViolations', () => getViolations(accessor, { limit: 100, offset: 0 })],
	['checkHeaders', () => checkHeaders(accessor, { limit: 100, offset: 0 })],
	['getLinkGraph', () => getLinkGraph(accessor)],
	['listPages offset0', () => listPages(accessor, { limit: 100, offset: 0 })],
	['listPages offset1000', () => listPages(accessor, { limit: 100, offset: 1000 })],
	['listPageLinks', () => listPageLinks(accessor, { limit: 100, offset: 0 })],
	[
		'listLinks broken',
		() => listLinks(accessor, { type: 'broken', limit: 100, offset: 0 }),
	],
	[
		'listLinks external',
		() => listLinks(accessor, { type: 'external', limit: 100, offset: 0 }),
	],
	['listResources', () => listResources(accessor, { limit: 100, offset: 0 })],
	['listImages', () => listImages(accessor, { limit: 100, offset: 0 })],
	['listIsolatedPages', () => listIsolatedPages(accessor, { limit: 100, offset: 0 })],
	[
		'listIsolatedClusters',
		() => listIsolatedClusters(accessor, { limit: 100, offset: 0 }),
	],
	['listUnusedResources', () => listUnusedResources(accessor, { limit: 100, offset: 0 })],
];

/**
 * Runs all bench cases and returns the per-case timing.
 * @param {string} label - Pass label.
 * @returns {Promise<Record<string, number>>} Map of case name to ms.
 */
async function runPass(label) {
	console.log(`\n══════════ ${label} ══════════`);
	const results = {};
	for (const [name, fn] of cases) {
		const start = process.hrtime.bigint();
		try {
			await fn();
			const ms = Number(process.hrtime.bigint() - start) / 1e6;
			results[name] = ms;
			console.log(`  ${ms.toFixed(0).padStart(8)}ms  ${name}`);
		} catch (error) {
			results[name] = Number.NaN;
			console.log(`  ${'ERR'.padStart(10)}  ${name}  ${error?.message ?? error}`);
		}
	}
	return results;
}

try {
	const baseline = await runPass('BASELINE (no extra indexes)');

	console.log('\n— Adding indexes —');
	const indexes = [
		// Pages base filter + url-ordered scan. Covers Pages, PageLinks,
		// IsolatedPages, IsolatedClusters, Summary's HTML page counts, and
		// Duplicates' base filter. Adopted unconditionally; the others were
		// validated by bench against this archive and either dropped (status
		// + anchors caused 30x regressions in listLinks/getLinkGraph) or
		// deferred to per-query investigation (findDuplicates, listUnusedResources).
		`CREATE INDEX idx_pages_listfilter ON pages(scraped, redirectDestId, url, contentType)`,
	];
	for (const sql of indexes) {
		const start = process.hrtime.bigint();
		try {
			await db.raw(sql);
			const ms = Number(process.hrtime.bigint() - start) / 1e6;
			console.log(
				`  ${ms.toFixed(0).padStart(6)}ms  ${sql.replaceAll(/\s+/g, ' ').slice(0, 100)}`,
			);
		} catch (error) {
			console.log(
				`  ${'skip'.padStart(8)}  ${sql.replaceAll(/\s+/g, ' ').slice(0, 100)}  [${error?.message ?? error}]`,
			);
		}
	}
	const analyzeStart = process.hrtime.bigint();
	await db.raw('ANALYZE');
	console.log(
		`  ${(Number(process.hrtime.bigint() - analyzeStart) / 1e6).toFixed(0).padStart(6)}ms  ANALYZE`,
	);

	const after = await runPass('AFTER (with new indexes)');

	console.log('\n— Speedup —');
	console.log('  speedup     before       after  query');
	for (const [name] of cases) {
		const b = baseline[name];
		const a = after[name];
		if (Number.isNaN(b) || Number.isNaN(a)) continue;
		const ratio = b / a;
		console.log(
			`  ${`${ratio.toFixed(1)}x`.padStart(7)}  ${`${b.toFixed(0)}ms`.padStart(8)}  ${`${a.toFixed(0)}ms`.padStart(8)}  ${name}`,
		);
	}
} finally {
	await db.destroy();
	rmSync(workDir, { recursive: true, force: true });
}
console.log('\nDone.');
