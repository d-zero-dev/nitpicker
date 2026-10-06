#!/usr/bin/env node
/**
 * Bench `query match-selector` against a real `.nitpicker` archive.
 *
 * Reports, per selector:
 *
 * - **end to end**: `matchSelector` over the whole archive (SQLite read +
 *   zstd decode + matching), with the per-layer counters it returns
 * - **layered vs stack only**: the same selector over an in-memory sample
 *   of decoded snapshots, once through the layered path (regular
 *   expression scan, ordered-literal prefilter, open-element stack) and
 *   once forced onto the open-element stack, so the cost of each layer and
 *   the agreement of the two exact layers are visible. Decoding is
 *   excluded and timed on its own as the baseline.
 *
 * `--verify N` additionally compares the first N sampled snapshots with
 * jsdom's `querySelector` after **re-parsing** the markup. That is a
 * reference, not ground truth: re-parsing rebuilds the tree
 * (`<p><div></div></p>` splits into two siblings), so disagreements are
 * printed with a hint and a count of those that cannot be explained by a
 * `<template>`. The ground truth is the DOM-before-serialization spec
 * `html-matches-selector.oracle.spec.ts`.
 *
 * USAGE
 * -----
 *
 *     yarn build
 *     node scripts/bench-match-selector.mjs <archive.nitpicker>
 *       [--selector <css>]... [--sample <N>] [--verify <N>]
 *
 * The archive is opened read-only through `ArchiveManager` (extracted to
 * the on-disk cache, never modified). NEVER runs `ANALYZE` — the
 * listfilter invariant. Output is timings and counts only; no URLs or
 * HTML are printed.
 */

/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import path from 'node:path';
import process from 'node:process';

import { decodeStoredBlob } from '@nitpicker/crawler';
import { ArchiveManager, matchSelector } from '@nitpicker/query';

// The layer comparison forces selectors onto the open-element stack, which the
// public API does not expose, so (like the other bench scripts) this reads the
// built `lib/` modules directly.
import { compileSelector } from '../packages/@nitpicker/query/lib/match-selector/compile-selector.js';
import { htmlMatchesSelector } from '../packages/@nitpicker/query/lib/match-selector/html-matches-selector.js';
import { planSelectorMatch } from '../packages/@nitpicker/query/lib/match-selector/plan-selector-match.js';

const DEFAULT_SELECTORS = [
	// decided by one start tag
	'a[href^="http"]',
	'img:not([alt])',
	'[data-nitpicker-bench-nonexistent]',
	// need the open-element stack
	'div.container > ul > li:nth-child(2n+1)',
	'body > header, body > footer',
	'main section p',
	// cannot be prefiltered: no literal can be derived
	':not(.zz) > :not(.yy)',
	// prefiltered away when a literal is missing
	'[data-nitpicker-bench-nonexistent] span',
];

/**
 * @param {string[]} argv - Arguments after the script path.
 * @returns {{ archive: string | undefined; selectors: string[]; sample: number; verify: number }} Parsed arguments.
 */
function parseArguments(argv) {
	const selectors = [];
	let archive;
	let sample = 2000;
	let verify = 0;
	for (let i = 0; i < argv.length; i++) {
		const argument = argv[i];
		switch (argument) {
			case '--selector': {
				selectors.push(argv[++i]);

				break;
			}
			case '--sample': {
				sample = Number(argv[++i]);

				break;
			}
			case '--verify': {
				verify = Number(argv[++i]);

				break;
			}
			default: {
				if (!argument.startsWith('--')) {
					archive = argument;
				}
			}
		}
	}
	return {
		archive,
		selectors: selectors.length > 0 ? selectors : DEFAULT_SELECTORS,
		sample,
		verify,
	};
}

const { archive, selectors, sample, verify } = parseArguments(process.argv.slice(2));
if (!archive) {
	console.error(
		'Usage: node scripts/bench-match-selector.mjs <archive.nitpicker> [--selector <css>]... [--sample <N>] [--verify <N>]',
	);
	process.exit(1);
}

const resolved = path.resolve(archive);
console.log(`Bench against ${resolved}\n`);

const manager = new ArchiveManager();
const opened = await manager.open(resolved);
const accessor = opened.accessor;
const knex = accessor.getKnex();

/**
 * @param {() => unknown} work - The work to time.
 * @returns {Promise<number>} Wall-clock milliseconds.
 */
async function time(work) {
	const start = process.hrtime.bigint();
	await work();
	return Number(process.hrtime.bigint() - start) / 1e6;
}

try {
	console.log('== end to end (whole archive) ==');
	for (const selector of selectors) {
		let result;
		const ms = await time(async () => {
			result = await matchSelector(accessor, { selector, limit: 0 });
		});
		console.log(
			`${ms.toFixed(0).padStart(7)}ms  ${selector}\n` +
				`         snapshots=${result.scannedSnapshots} pages=${result.candidatePages} ` +
				`prefiltered=${result.prefilteredSnapshots} tokenized=${result.tokenizedSnapshots} ` +
				`matchedSnapshots=${result.matchedSnapshots} matchedPages=${result.total}`,
		);
	}

	// Distinct snapshots that a live page references, like the real scan.
	const rows = await knex('page_html_blobs as phb')
		.whereExists(function () {
			this.select(knex.raw('1'))
				.from('page_html_ref as phr')
				.whereRaw('phr.hash = phb.hash');
		})
		.select('phb.body', 'phb.codec')
		.limit(sample);
	const documents = [];
	const decodeMs = await time(() => {
		for (const row of rows) {
			documents.push(decodeStoredBlob(row.body, row.codec));
		}
	});
	const bytes = documents.reduce((sum, html) => sum + Buffer.byteLength(html), 0);
	const megabytes = bytes / 1024 / 1024;
	console.log(
		`\n== sample: ${documents.length} snapshots, ${megabytes.toFixed(1)} MB decoded (decode ${decodeMs.toFixed(0)}ms = ${(megabytes / (decodeMs / 1000)).toFixed(0)} MB/s) ==`,
	);

	console.log('\n== layered vs stack only (decoded sample, decode excluded) ==');
	for (const selector of selectors) {
		const plan = planSelectorMatch(compileSelector(selector));
		const stackOnly = {
			...plan,
			directRegExp: null,
			tokenizedAlternatives: plan.allAlternatives,
		};
		let layeredMatches = 0;
		let stackMatches = 0;
		let disagreements = 0;
		const layeredResults = [];
		const layeredMs = await time(() => {
			for (const html of documents) {
				const outcome = htmlMatchesSelector({ plan, html });
				layeredResults.push(outcome.matched);
				layeredMatches += outcome.matched ? 1 : 0;
			}
		});
		const stackMs = await time(() => {
			for (const [index, html] of documents.entries()) {
				const matched = htmlMatchesSelector({ plan: stackOnly, html }).matched;
				stackMatches += matched ? 1 : 0;
				disagreements += matched === layeredResults[index] ? 0 : 1;
			}
		});
		console.log(
			`layered ${layeredMs.toFixed(0).padStart(6)}ms (${(megabytes / (layeredMs / 1000)).toFixed(0)} MB/s)  ` +
				`stack-only ${stackMs.toFixed(0).padStart(6)}ms (${(megabytes / (stackMs / 1000)).toFixed(0)} MB/s)  ` +
				`matches ${layeredMatches}/${stackMatches}  layer disagreements ${disagreements}  ${selector}`,
		);
	}

	if (verify > 0) {
		const { JSDOM } = await import('jsdom');
		console.log(`\n== jsdom re-parse reference on the first ${verify} snapshots ==`);
		for (const selector of selectors) {
			const plan = planSelectorMatch(compileSelector(selector));
			let compared = 0;
			let templateDifferences = 0;
			let otherDifferences = 0;
			for (const html of documents.slice(0, verify)) {
				const ours = htmlMatchesSelector({ plan, html }).matched;
				let reference;
				try {
					reference = new JSDOM(html).window.document.querySelector(selector) !== null;
				} catch {
					continue;
				}
				compared++;
				if (ours !== reference) {
					if (html.includes('<template')) {
						templateDifferences++;
					} else {
						otherDifferences++;
					}
				}
			}
			console.log(
				`${selector}\n         compared=${compared} differ(template)=${templateDifferences} differ(other: re-parse or bug)=${otherDifferences}`,
			);
		}
	}
} finally {
	await manager.close(opened.archiveId);
}
