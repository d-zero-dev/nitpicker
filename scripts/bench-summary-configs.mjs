#!/usr/bin/env node
/* eslint-disable no-console */

import process from 'node:process';

import Archive from '../packages/@nitpicker/crawler/lib/archive/archive.js';
import { getSummary } from '../packages/@nitpicker/query/lib/get-summary.js';

const dbDir = process.argv[2] || '/tmp/perf-dir';

const accessor = await Archive.connect(dbDir);
const db = accessor.getKnex();

await db.raw('DROP INDEX IF EXISTS idx_pages_summary_status');
await db.raw('DROP INDEX IF EXISTS idx_pages_summary_contenttype');

const PHASES = [
	{ label: 'NEITHER', setup: async () => {} },
	{
		label: 'ONLY idx_pages_summary_status',
		setup: async () => {
			await db.raw(
				`CREATE INDEX idx_pages_summary_status ON pages(scraped, redirectDestId, isExternal, status)`,
			);
		},
		teardown: async () => {
			await db.raw('DROP INDEX idx_pages_summary_status');
		},
	},
	{
		label: 'ONLY idx_pages_summary_contenttype',
		setup: async () => {
			await db.raw(
				`CREATE INDEX idx_pages_summary_contenttype ON pages(scraped, redirectDestId, contentType, isExternal, isSkipped)`,
			);
		},
		teardown: async () => {
			await db.raw('DROP INDEX idx_pages_summary_contenttype');
		},
	},
	{
		label: 'BOTH',
		setup: async () => {
			await db.raw(
				`CREATE INDEX idx_pages_summary_status ON pages(scraped, redirectDestId, isExternal, status)`,
			);
			await db.raw(
				`CREATE INDEX idx_pages_summary_contenttype ON pages(scraped, redirectDestId, contentType, isExternal, isSkipped)`,
			);
		},
		teardown: async () => {
			await db.raw('DROP INDEX idx_pages_summary_status');
			await db.raw('DROP INDEX idx_pages_summary_contenttype');
		},
	},
];

const results = {};
for (const phase of PHASES) {
	console.log(`\n========== ${phase.label} ==========`);
	await phase.setup();

	// EXPLAIN for each of the 4 summary inner queries
	const inner = {
		Q1: `SELECT isExternal, status, count(id) as count FROM pages
			WHERE scraped=1 AND redirectDestId IS NULL
				AND (isSkipped=0 OR isSkipped IS NULL)
				AND (contentType IS NULL OR contentType='text/html')
			GROUP BY isExternal, status`,
		Q2: `SELECT COUNT(*) FROM pages
			WHERE scraped=1 AND isExternal=0 AND contentType='text/html' AND redirectDestId IS NULL`,
		Q3: `SELECT contentType, isExternal, count(id) as count FROM pages
			WHERE scraped=1 AND redirectDestId IS NULL
				AND (isSkipped=0 OR isSkipped IS NULL)
			GROUP BY contentType, isExternal`,
		Q4: `SELECT id FROM pages
			WHERE scraped=1 AND status=-1 AND redirectDestId IS NULL`,
	};
	for (const [name, sql] of Object.entries(inner)) {
		const plan = await db.raw('EXPLAIN QUERY PLAN ' + sql);
		console.log(`  ${name}: ${plan.map((r) => r.detail).join(' | ')}`);
	}

	// Time getSummary 3 times after one warmup
	await getSummary(accessor);
	const samples = [];
	for (let i = 0; i < 3; i++) {
		const t = process.hrtime.bigint();
		await getSummary(accessor);
		const ms = Number(process.hrtime.bigint() - t) / 1e6;
		samples.push(ms);
	}
	const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
	const min = Math.min(...samples);
	const max = Math.max(...samples);
	results[phase.label] = { avg, min, max, samples };
	console.log(
		`  getSummary: avg ${avg.toFixed(0)}ms (${samples.map((s) => s.toFixed(0)).join(', ')})`,
	);

	if (phase.teardown) await phase.teardown();
}

console.log('\n========== SUMMARY ==========');
for (const [label, r] of Object.entries(results)) {
	console.log(
		`  ${label.padEnd(40)} ${r.avg.toFixed(0)}ms avg  min ${r.min.toFixed(0)}ms  max ${r.max.toFixed(0)}ms`,
	);
}

await accessor.close();
