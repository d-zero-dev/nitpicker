#!/usr/bin/env node
/**
 * Compares inline URL sort-key storage against `viewer_url_refs`-backed
 * storage for the `viewer_anchor_facts` / `viewer_external_links` read-model
 * shape introduced by issue #139.
 *
 * USAGE
 * -----
 *
 *     yarn build && node scripts/bench-viewer-url-refs.mjs
 *
 * `BENCH_SIZES=50000,200000` controls edge counts. The dataset is fully
 * synthetic and disk-backed under the OS temp directory; no archive path or
 * site name is hard-coded.
 */

/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import { mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import knex from 'knex';

import { LibsqlDialect } from '../packages/@nitpicker/crawler/lib/archive/libsql-dialect.js';

const SIZES = process.env.BENCH_SIZES
	? process.env.BENCH_SIZES.split(',').map((s) => Number(s.trim()))
	: [50_000];
const WARM_ITERATIONS = 30;

/**
 * Returns a percentile from the already-recorded timing sample.
 * @param values - Timing values in milliseconds.
 * @param ratio - Percentile ratio between 0 and 1.
 * @returns The percentile value, or 0 for an empty sample.
 */
function percentile(values, ratio) {
	const sorted = values.toSorted((a, b) => a - b);
	return sorted[Math.floor(sorted.length * ratio)] ?? 0;
}

/**
 * Produces deterministic, intentionally duplicated synthetic URLs.
 * @param index - Synthetic edge-derived URL index.
 * @returns A URL string with bounded distinct cardinality.
 */
function makeUrl(index) {
	const repeatedTemplate = index % 5;
	const page = String(index % 10_000).padStart(6, '0');
	return `https://example.com/template-${repeatedTemplate}/page-${page}`;
}

/**
 * Creates one temporary disk-backed SQLite database for a benchmark variant.
 * @param label - Variant label used in the temporary directory name.
 * @param edgeCount - Number of synthetic edges being benchmarked.
 * @returns The database handle and cleanup paths.
 */
async function makeDb(label, edgeCount) {
	const dir = path.join(
		tmpdir(),
		`nitpicker-bench-viewer-url-refs-${label}-${edgeCount}-${process.pid}`,
	);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	const dbFilePath = path.join(dir, 'db.sqlite');
	const db = knex({
		client: LibsqlDialect,
		connection: { filename: dbFilePath },
		useNullAsDefault: true,
	});
	return { db, dbFilePath, dir };
}

/**
 * Seeds the pre-#139 inline URL storage shape.
 * @param edgeCount - Number of synthetic anchor facts to insert.
 * @returns Database handles and cleanup paths for the inline variant.
 */
async function seedInline(edgeCount) {
	const { db, dbFilePath, dir } = await makeDb('inline', edgeCount);
	await db.schema.createTable('viewer_anchor_facts', (t) => {
		t.integer('edge_id').primary();
		t.text('source_url_sort_key').notNullable();
		t.text('dest_url_sort_key').notNullable();
		t.integer('status');
		t.integer('status_sort_key').notNullable();
		t.integer('status_desc_key').notNullable();
		t.integer('is_broken').notNullable();
	});
	await db.schema.createTable('viewer_external_links', (t) => {
		t.integer('dest_page_id').primary();
		t.text('dest_url').notNullable();
		t.integer('status');
		t.integer('referrer_count').notNullable();
	});
	const rows = [];
	const externalRows = [];
	for (let edgeId = 1; edgeId <= edgeCount; edgeId++) {
		const status = edgeId % 7 === 0 ? 404 : 200;
		rows.push({
			edge_id: edgeId,
			source_url_sort_key: makeUrl(edgeId),
			dest_url_sort_key: makeUrl(edgeId * 13),
			status,
			status_sort_key: status,
			status_desc_key: -status,
			is_broken: status === 404 ? 1 : 0,
		});
		if (edgeId % 11 === 0) {
			externalRows.push({
				dest_page_id: edgeId,
				dest_url: makeUrl(edgeId * 13),
				status,
				referrer_count: 1 + (edgeId % 17),
			});
		}
		if (rows.length >= 500) {
			await db('viewer_anchor_facts').insert(rows);
			rows.length = 0;
		}
		if (externalRows.length >= 500) {
			await db('viewer_external_links').insert(externalRows);
			externalRows.length = 0;
		}
	}
	if (rows.length > 0) {
		await db('viewer_anchor_facts').insert(rows);
	}
	if (externalRows.length > 0) {
		await db('viewer_external_links').insert(externalRows);
	}
	await db.raw(
		'CREATE INDEX vaf_broken_source ON viewer_anchor_facts(is_broken, source_url_sort_key, edge_id)',
	);
	await db.raw(
		'CREATE INDEX vaf_broken_dest ON viewer_anchor_facts(is_broken, dest_url_sort_key, edge_id)',
	);
	await db.raw(
		'CREATE INDEX vaf_broken_status ON viewer_anchor_facts(is_broken, status_sort_key, source_url_sort_key, edge_id)',
	);
	await db.raw('CREATE INDEX vel_url ON viewer_external_links(dest_url, dest_page_id)');
	await db.raw(
		'CREATE INDEX vel_status ON viewer_external_links(status, dest_url, dest_page_id)',
	);
	await db.raw(
		'CREATE INDEX vel_referrer_count ON viewer_external_links(referrer_count, dest_url, dest_page_id)',
	);
	return { db, dbFilePath, dir };
}

/**
 * Seeds the #139 URL-reference storage shape.
 * @param edgeCount - Number of synthetic anchor facts to insert.
 * @returns Database handles, cleanup paths, and distinct URL count.
 */
async function seedRef(edgeCount) {
	const { db, dbFilePath, dir } = await makeDb('ref', edgeCount);
	await db.schema.createTable('viewer_url_refs', (t) => {
		t.integer('id').primary();
		t.text('url').notNullable().unique();
	});
	await db.schema.createTable('viewer_anchor_facts', (t) => {
		t.integer('edge_id').primary();
		t.integer('source_url_ref_id').notNullable();
		t.integer('dest_url_ref_id').notNullable();
		t.integer('status');
		t.integer('status_sort_key').notNullable();
		t.integer('status_desc_key').notNullable();
		t.integer('is_broken').notNullable();
	});
	await db.schema.createTable('viewer_external_links', (t) => {
		t.integer('dest_page_id').primary();
		t.integer('dest_url_ref_id').notNullable();
		t.integer('status');
		t.integer('referrer_count').notNullable();
	});
	const urlSet = new Set();
	for (let edgeId = 1; edgeId <= edgeCount; edgeId++) {
		urlSet.add(makeUrl(edgeId));
		urlSet.add(makeUrl(edgeId * 13));
	}
	const urls = [...urlSet].toSorted();
	const idByUrl = new Map(urls.map((url, index) => [url, index + 1]));
	for (let start = 0; start < urls.length; start += 500) {
		await db('viewer_url_refs').insert(
			urls.slice(start, start + 500).map((url, index) => ({
				id: start + index + 1,
				url,
			})),
		);
	}
	const rows = [];
	const externalRows = [];
	for (let edgeId = 1; edgeId <= edgeCount; edgeId++) {
		const status = edgeId % 7 === 0 ? 404 : 200;
		rows.push({
			edge_id: edgeId,
			source_url_ref_id: idByUrl.get(makeUrl(edgeId)),
			dest_url_ref_id: idByUrl.get(makeUrl(edgeId * 13)),
			status,
			status_sort_key: status,
			status_desc_key: -status,
			is_broken: status === 404 ? 1 : 0,
		});
		if (edgeId % 11 === 0) {
			externalRows.push({
				dest_page_id: edgeId,
				dest_url_ref_id: idByUrl.get(makeUrl(edgeId * 13)),
				status,
				referrer_count: 1 + (edgeId % 17),
			});
		}
		if (rows.length >= 500) {
			await db('viewer_anchor_facts').insert(rows);
			rows.length = 0;
		}
		if (externalRows.length >= 500) {
			await db('viewer_external_links').insert(externalRows);
			externalRows.length = 0;
		}
	}
	if (rows.length > 0) {
		await db('viewer_anchor_facts').insert(rows);
	}
	if (externalRows.length > 0) {
		await db('viewer_external_links').insert(externalRows);
	}
	await db.raw(
		'CREATE INDEX vaf_broken_source ON viewer_anchor_facts(is_broken, source_url_ref_id, edge_id)',
	);
	await db.raw(
		'CREATE INDEX vaf_broken_dest ON viewer_anchor_facts(is_broken, dest_url_ref_id, edge_id)',
	);
	await db.raw(
		'CREATE INDEX vaf_broken_status ON viewer_anchor_facts(is_broken, status_sort_key, source_url_ref_id, edge_id)',
	);
	await db.raw(
		'CREATE INDEX vel_url ON viewer_external_links(dest_url_ref_id, dest_page_id)',
	);
	await db.raw(
		'CREATE INDEX vel_status ON viewer_external_links(status, dest_url_ref_id, dest_page_id)',
	);
	await db.raw(
		'CREATE INDEX vel_referrer_count ON viewer_external_links(referrer_count, dest_url_ref_id, dest_page_id)',
	);
	return { db, dbFilePath, dir, distinctUrlCount: urls.length };
}

/**
 * Times one representative read query and records its query plan.
 * @param db - Database handle to query.
 * @param sql - SQL statement to time and explain.
 * @returns Warm p50/p95 timings and a compact `EXPLAIN QUERY PLAN` string.
 */
async function timeQuery(db, sql) {
	const timings = [];
	for (let i = 0; i < WARM_ITERATIONS; i++) {
		const start = process.hrtime.bigint();
		await db.raw(sql);
		timings.push(Number(process.hrtime.bigint() - start) / 1e6);
	}
	const explainRows = await db.raw(`EXPLAIN QUERY PLAN ${sql}`);
	return {
		p50: percentile(timings, 0.5),
		p95: percentile(timings, 0.95),
		explain: explainRows.map((row) => row.detail).join(' | '),
	};
}

for (const edgeCount of SIZES) {
	const inline = await seedInline(edgeCount);
	const ref = await seedRef(edgeCount);
	try {
		const inlineSize = statSync(inline.dbFilePath).size;
		const refSize = statSync(ref.dbFilePath).size;
		const inlineTiming = await timeQuery(
			inline.db,
			'SELECT edge_id, source_url_sort_key, dest_url_sort_key, status FROM viewer_anchor_facts WHERE is_broken = 1 ORDER BY source_url_sort_key, edge_id LIMIT 101',
		);
		const refTiming = await timeQuery(
			ref.db,
			`WITH window AS (
				SELECT edge_id, source_url_ref_id, dest_url_ref_id, status
				FROM viewer_anchor_facts
				WHERE is_broken = 1
				ORDER BY source_url_ref_id, edge_id
				LIMIT 101
			)
			SELECT window.edge_id, source_ref.url, dest_ref.url, window.status
			FROM window
			JOIN viewer_url_refs AS source_ref ON source_ref.id = window.source_url_ref_id
			JOIN viewer_url_refs AS dest_ref ON dest_ref.id = window.dest_url_ref_id
			ORDER BY window.source_url_ref_id, window.edge_id`,
		);
		const inlineExternalTiming = await timeQuery(
			inline.db,
			'SELECT dest_page_id, dest_url, status, referrer_count FROM viewer_external_links ORDER BY dest_url, dest_page_id LIMIT 101',
		);
		const refExternalTiming = await timeQuery(
			ref.db,
			`SELECT e.dest_page_id, u.url, e.status, e.referrer_count
			FROM viewer_external_links AS e
			LEFT JOIN viewer_url_refs AS u ON u.id = e.dest_url_ref_id
			ORDER BY e.dest_url_ref_id, e.dest_page_id
			LIMIT 101`,
		);
		console.log(`\n${edgeCount.toLocaleString()} synthetic edges`);
		console.log(`  inline DB size: ${(inlineSize / 1024 / 1024).toFixed(1)} MiB`);
		console.log(
			`  ref DB size:    ${(refSize / 1024 / 1024).toFixed(1)} MiB (${ref.distinctUrlCount.toLocaleString()} distinct URLs)`,
		);
		console.log(
			`  savings:        ${(((inlineSize - refSize) / inlineSize) * 100).toFixed(1)}%`,
		);
		console.log(
			`  inline sourceUrl p50/p95: ${inlineTiming.p50.toFixed(2)}ms / ${inlineTiming.p95.toFixed(2)}ms`,
		);
		console.log(
			`  ref sourceUrl p50/p95:    ${refTiming.p50.toFixed(2)}ms / ${refTiming.p95.toFixed(2)}ms`,
		);
		console.log(
			`  inline external p50/p95:  ${inlineExternalTiming.p50.toFixed(2)}ms / ${inlineExternalTiming.p95.toFixed(2)}ms`,
		);
		console.log(
			`  ref external p50/p95:     ${refExternalTiming.p50.toFixed(2)}ms / ${refExternalTiming.p95.toFixed(2)}ms`,
		);
		console.log(`  inline EXPLAIN: ${inlineTiming.explain}`);
		console.log(`  ref EXPLAIN:    ${refTiming.explain}`);
		console.log(`  inline external EXPLAIN: ${inlineExternalTiming.explain}`);
		console.log(`  ref external EXPLAIN:    ${refExternalTiming.explain}`);
	} finally {
		await inline.db.destroy();
		await ref.db.destroy();
		rmSync(inline.dir, { recursive: true, force: true });
		rmSync(ref.dir, { recursive: true, force: true });
	}
}
