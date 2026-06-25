#!/usr/bin/env node
/**
 * Bench every viewer HTTP endpoint warm against a real `.nitpicker`
 * archive, in-process (no actual TCP server). Uses Hono's `app.request`
 * so the full middleware stack — including the `Server-Timing`
 * middleware — fires exactly as it does in production.
 *
 * Why in-process rather than spawning the CLI viewer:
 *   - No port-allocation flake (the user previously hit IPv6 vs IPv4
 *     binding inconsistencies).
 *   - No HTTP round-trip overhead in the measurement; the Server-Timing
 *     header still captures the per-request wall-clock the way DevTools
 *     reports it.
 *   - Each warm sample re-enters the same `ArchiveAccessor`, so
 *     in-memory caches (PR #98 tar cache, the precompute LRUs added by
 *     this PR) reflect production behaviour from sample 2 onwards.
 *
 * Each endpoint is hit `WARMUP + SAMPLES` times. The first run primes
 * SQLite's page cache + libsql mmap window + the viewer-side precompute
 * LRUs; the remaining samples are averaged and reported alongside min /
 * max so spread is visible.
 *
 * USAGE
 * -----
 *
 *     node scripts/bench-viewer-endpoints.mjs <archive.nitpicker>
 *
 * NEVER runs ANALYZE / PRAGMA optimize.
 */

/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import process from 'node:process';

import { ArchiveManager } from '@nitpicker/query';
import { createApp } from '@nitpicker/viewer/create-app';

/**
 * One untimed primer run per endpoint to load index pages + mmap
 * windows + populate the viewer's precompute caches, then this many
 * timed samples averaged for the reported number.
 */
const WARMUP = 1;
const SAMPLES = 3;

/**
 * Endpoints exercised, ordered slowest-to-fastest in the warm baseline
 * captured 2026-06-25 on a 10 GB archive. Each entry pairs a
 * human-readable label with the request URL.
 */
const ENDPOINTS = [
	{ label: 'info', url: '/api/info' },
	{ label: 'summary', url: '/api/summary' },
	{ label: 'page-links', url: '/api/page-links?limit=100&offset=0' },
	{ label: 'links?type=broken', url: '/api/links?type=broken&limit=100&offset=0' },
	{ label: 'isolated-pages', url: '/api/isolated-pages?limit=100&offset=0' },
	{ label: 'isolated-clusters', url: '/api/isolated-clusters?limit=100&offset=0' },
	{ label: 'duplicates?field=title', url: '/api/duplicates?field=title' },
	{ label: 'mismatches?type=canonical', url: '/api/mismatches?type=canonical' },
	{ label: 'images', url: '/api/images?limit=100&offset=0' },
	{ label: 'unused-resources', url: '/api/unused-resources?limit=100&offset=0' },
	{ label: 'pages', url: '/api/pages?limit=100&offset=0' },
];

const archivePath = process.argv[2];
if (!archivePath) {
	console.error('Usage: node scripts/bench-viewer-endpoints.mjs <archive.nitpicker>');
	process.exit(1);
}

await main(archivePath);

/**
 * Top-level bench orchestration. Pulled out so the `try/finally` for
 * `closeAll` wraps the entire opened-archive lifetime — without it a
 * mid-bench throw (e.g. a 5xx surfaced as an exception by future
 * middleware) would leak the archive lock + tmpDir and break the next
 * bench invocation on the same file.
 * @param archivePathArg - The `.nitpicker` path to bench against.
 */
async function main(archivePathArg) {
	console.log(`opening archive (cache mode if PR #98 + warm)...`);
	const t0 = process.hrtime.bigint();
	const manager = new ArchiveManager();
	const { archiveId, mode } = await manager.open(archivePathArg);
	const openMs = Number(process.hrtime.bigint() - t0) / 1e6;
	console.log(`  open: ${openMs.toFixed(0)}ms (mode=${mode})`);

	const context = {
		manager,
		archiveId,
		filePath: archivePathArg,
		mode,
		crawlerLockHolder: null,
	};
	const app = createApp({ context, publicDir: '/tmp/no-such-dir' });

	try {
		await runBench(app);
	} finally {
		await manager.closeAll();
	}
}

/**
 * Hit every endpoint `WARMUP + SAMPLES` times, fail loudly on any
 * non-2xx response so a regression that breaks an endpoint isn't
 * silently measured as fast.
 * @param app - The in-process Hono application.
 */
async function runBench(app) {
	console.log(
		`\nendpoint                                    warm avg     min     max  samples`,
	);
	console.log(
		`--------------------------------------------------------------------------`,
	);

	for (const { label, url } of ENDPOINTS) {
		for (let i = 0; i < WARMUP; i++) {
			const r = await app.request(url);
			await r.text();
			assertOk(r, url);
		}
		const samples = [];
		for (let i = 0; i < SAMPLES; i++) {
			const t1 = process.hrtime.bigint();
			const res = await app.request(url);
			await res.text();
			assertOk(res, url);
			const ms = Number(process.hrtime.bigint() - t1) / 1e6;
			samples.push(ms);
		}
		const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
		const min = Math.min(...samples);
		const max = Math.max(...samples);
		console.log(
			`  ${label.padEnd(40)}${formatMs(avg).padStart(8)}${formatMs(min).padStart(8)}${formatMs(max).padStart(8)}${String(SAMPLES).padStart(9)}`,
		);
	}
}

/**
 * Throw on non-2xx responses so a 500-as-fast-success can never sneak
 * into the table. Without this guard a regression that breaks an
 * endpoint reports a few milliseconds and the operator concludes the
 * perf work succeeded.
 * @param res - The Hono Response.
 * @param url - The bench URL (included in the thrown message).
 */
function assertOk(res, url) {
	if (!res.ok) {
		throw new Error(`Endpoint returned ${res.status} for ${url}`);
	}
}

/**
 * Format milliseconds for the column-aligned summary. Sub-second times
 * stay in ms (no decimal) so the eye picks up regressions; seconds get
 * one decimal so a 1.8s improvement is visible against a 1.0s neighbour.
 * @param ms - Wall-clock duration in milliseconds.
 * @returns Compact human-readable string.
 */
function formatMs(ms) {
	if (ms < 1000) {
		return `${ms.toFixed(0)}ms`;
	}
	return `${(ms / 1000).toFixed(1)}s`;
}
