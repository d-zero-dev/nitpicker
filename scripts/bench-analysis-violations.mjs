#!/usr/bin/env node
/**
 * Synthetic benchmark for the SQL-backed analysis violations read path.
 *
 * It creates a temporary archive, populates `pages` and `analysis_violations`,
 * then prints timings and `EXPLAIN QUERY PLAN` for the common list/filter
 * shapes used by `/api/violations`.
 */

/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { getViolations } from '@nitpicker/query';

const pageCount = Number(process.argv[2] ?? 100);
const violationCount = Number(process.argv[3] ?? 10_000);
const workingDir = mkdtempSync(path.join(tmpdir(), 'nitpicker-violations-bench-'));
const archivePath = path.join(workingDir, 'bench.nitpicker');

const config = {
	baseUrl: 'https://example.com',
	name: 'analysis-violations-bench',
	version: '0.10.0',
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
	userAgent: 'bench',
	ignoreRobots: false,
};

/**
 *
 * @param url
 */
function createPage(url) {
	return {
		url: parseUrl(url),
		redirectPaths: [],
		isExternal: false,
		isTarget: true,
		status: 200,
		statusText: 'OK',
		contentType: 'text/html',
		contentLength: 100,
		responseHeaders: {},
		html: '<html><head><title>Bench</title></head><body></body></html>',
		meta: {
			lang: 'en',
			title: 'Bench',
			description: null,
			keywords: null,
			noindex: false,
			nofollow: false,
			noarchive: false,
			canonical: null,
			alternate: null,
			'og:type': null,
			'og:title': null,
			'og:site_name': null,
			'og:description': null,
			'og:url': null,
			'og:image': null,
			'twitter:card': null,
		},
		anchorList: [],
		imageList: [],
		isSkipped: false,
	};
}

/**
 *
 * @param rows
 */
function formatPlan(rows) {
	return rows.map((row) => row.detail).join(' | ');
}

/**
 *
 * @param label
 * @param fn
 */
async function time(label, fn) {
	const start = process.hrtime.bigint();
	await fn();
	const ms = Number(process.hrtime.bigint() - start) / 1e6;
	console.log(`${label}: ${ms.toFixed(2)}ms`);
}

const archive = await Archive.create({ filePath: archivePath, cwd: workingDir });
try {
	await archive.setConfig(config);
	for (let index = 0; index < pageCount; index++) {
		await archive.setPage(createPage(`https://example.com/page-${index}/`));
	}

	const violations = Array.from({ length: violationCount }, (_, index) => {
		const pageIndex = index % pageCount;
		const validator = index % 2 === 0 ? 'axe' : 'textlint';
		const severity = index % 3 === 0 ? 'error' : 'warning';
		const rule = index % 5 === 0 ? 'color-contrast' : 'no-doubled-joshi';
		return {
			url: `https://example.com/page-${pageIndex}/`,
			validator,
			severity,
			rule,
			message: `message ${index % 100}`,
			code: index % 7 === 0 ? `<div data-index="${index % 50}">` : '',
		};
	});

	await time('replaceAnalysisViolations', () =>
		archive.replaceAnalysisViolations(violations),
	);
	await time('getViolations default', () => getViolations(archive, { limit: 100 }));
	await time('getViolations combined filter', () =>
		getViolations(archive, {
			validator: 'axe',
			severity: 'error',
			rule: 'color-contrast',
			limit: 100,
		}),
	);

	const knex = archive.getKnex();
	const defaultPlan = await knex.raw(
		'EXPLAIN QUERY PLAN select id from analysis_violations order by page_url_sort_key asc, id asc limit 100',
	);
	const filterPlan = await knex.raw(
		"EXPLAIN QUERY PLAN select id from analysis_violations where validator = 'axe' and severity = 'error' and rule = 'color-contrast' order by page_url_sort_key asc, id asc limit 100",
	);

	console.log(`default plan: ${formatPlan(defaultPlan)}`);
	console.log(`combined filter plan: ${formatPlan(filterPlan)}`);
} finally {
	await archive.close();
	rmSync(workingDir, { recursive: true, force: true });
}
