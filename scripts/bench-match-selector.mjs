#!/usr/bin/env node
/**
 * Bench `query match-selector` against a real `.nitpicker` archive.
 *
 * Reports, per selector:
 *
 * - **end to end**: `matchSelector` over the whole archive (SQLite read +
 *   zstd decode + matching), with the per-stage counters it returns
 * - **staged vs stack only**: the same selector over an in-memory sample
 *   of decoded snapshots, once through the staged path (regular
 *   expression scan, ordered-literal prefilter, open-element stack) and
 *   once forced onto the open-element stack, so the cost of each stage and
 *   the agreement of the two exact stages are visible. Decoding is
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
 * With `--case <name>` the script instead measures one baseline case end to
 * end — `simple` (one start tag decides), `compound` (descendant
 * combinators on the open-element stack) or `nth` (`:nth-child()`) — and
 * prints the shared bench record (`--json` for one JSON line), the same
 * one-case-per-run contract as the other `bench-*.mjs` baselines. `--json`
 * also selects that mode (the stage comparison has no machine-readable
 * output). The stage-comparison options (`--selector`, `--sample`,
 * `--verify`) are rejected there, and the stage comparison rejects any
 * other option.
 *
 * USAGE
 * -----
 *
 *     yarn build
 *     node scripts/bench-match-selector.mjs <archive.nitpicker>
 *       [--selector <css>]... [--sample <N>] [--verify <N>]
 *     node scripts/bench-match-selector.mjs <archive.nitpicker>
 *       --case simple|compound|nth [--json]
 *
 * The archive is opened read-only through `ArchiveManager` (extracted to
 * the on-disk cache, never modified). NEVER runs `ANALYZE` — the
 * listfilter invariant. Output is timings and counts only; no URLs or
 * HTML are printed.
 */

/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import process from 'node:process';

import { decodeStoredBlob } from '@nitpicker/archive/decode-html-blob';
import { matchSelector } from '@nitpicker/query';

// The stage comparison forces selectors onto the open-element stack, which the
// public API does not expose, so (like the other bench scripts) this reads the
// built `lib/` modules directly.
import { compileSelector } from '../packages/@nitpicker/query/lib/match-selector/compile-selector.js';
import { htmlMatchesSelector } from '../packages/@nitpicker/query/lib/match-selector/html-matches-selector.js';
import { planSelectorMatch } from '../packages/@nitpicker/query/lib/match-selector/plan-selector-match.js';

import { countInternalPages } from './bench-lib/count-internal-pages.mjs';
import { iterateHtmlBlobs } from './bench-lib/iterate-html-blobs.mjs';
import { measureMs } from './bench-lib/measure-ms.mjs';
import { readBenchArguments } from './bench-lib/read-bench-arguments.mjs';
import { reportBenchResult } from './bench-lib/report-bench-result.mjs';
import { withReadOnlyArchive } from './bench-lib/with-read-only-archive.mjs';

/** One selector per case in `BENCH_CASES['match-selector']`. */
const BASELINE_SELECTORS = {
	simple: 'a[href^="http"]',
	compound: 'main section p',
	nth: 'li:nth-child(2n+1)',
};

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
 * Measures one baseline case and prints the shared bench record.
 */
async function runBaselineCase() {
	const { archive, caseName, json } = readBenchArguments('match-selector');
	const selector = BASELINE_SELECTORS[caseName];
	if (selector === undefined) {
		throw new Error(`bench-match-selector has no selector for case "${caseName}"`);
	}
	await withReadOnlyArchive(archive, async (accessor) => {
		const { ms, value: result } = await measureMs(() =>
			matchSelector(accessor, { selector, limit: 0 }),
		);
		await reportBenchResult({
			bench: 'match-selector',
			caseName,
			archivePath: archive,
			pageCount: await countInternalPages(accessor.getKnex()),
			timeMs: ms,
			metrics: {
				selector,
				scannedSnapshots: result.scannedSnapshots,
				prefilteredSnapshots: result.prefilteredSnapshots,
				tokenizedSnapshots: result.tokenizedSnapshots,
				matchedPages: result.total,
			},
			json,
		});
	});
}

/**
 * @param {string[]} argv - Arguments after the script path.
 * @returns {{ archive: string | undefined; selectors: string[]; sample: number; verify: number; error: string | undefined }}
 *   Parsed arguments; `error` describes the first unknown option or option
 *   without a value, if any.
 */
function parseArguments(argv) {
	const selectors = [];
	let archive;
	let sample = 2000;
	let verify = 0;
	let error;
	for (let i = 0; i < argv.length; i++) {
		const argument = argv[i];
		if (STAGE_OPTIONS_WITH_VALUE.has(argument)) {
			const value = argv[++i];
			if (value === undefined || value.startsWith('--')) {
				error ??= `${argument} needs a value`;
				continue;
			}
			if (argument === '--selector') {
				selectors.push(value);
			} else if (argument === '--sample') {
				sample = Number(value);
			} else {
				verify = Number(value);
			}
			continue;
		}
		if (argument.startsWith('--')) {
			error ??= `Unknown option ${argument}`;
			continue;
		}
		archive = argument;
	}
	return {
		archive,
		selectors: selectors.length > 0 ? selectors : DEFAULT_SELECTORS,
		sample,
		verify,
		error,
	};
}

/**
 * Prints the end-to-end, staged-vs-stack and optional jsdom comparisons.
 */
async function runStageComparison() {
	const { archive, selectors, sample, verify, error } = parseArguments(
		process.argv.slice(2),
	);
	if (!archive || error) {
		if (error) {
			console.error(error);
		}
		console.error(
			'Usage: node scripts/bench-match-selector.mjs <archive.nitpicker> [--selector <css>]... [--sample <N>] [--verify <N>]\n' +
				'       node scripts/bench-match-selector.mjs <archive.nitpicker> --case simple|compound|nth [--json]',
		);
		process.exitCode = 1;
		return;
	}

	await withReadOnlyArchive(archive, (accessor) =>
		printStageComparison({ accessor, selectors, sample, verify }),
	);
}

/**
 * @param {{ accessor: import('@nitpicker/archive/archive-accessor').ArchiveAccessor; selectors: string[]; sample: number; verify: number }} params
 *   The open archive and the comparison settings.
 */
async function printStageComparison({ accessor, selectors, sample, verify }) {
	const knex = accessor.getKnex();
	console.log('== end to end (whole archive) ==');
	for (const selector of selectors) {
		const { ms, value: result } = await measureMs(() =>
			matchSelector(accessor, { selector, limit: 0 }),
		);
		console.log(
			`${ms.toFixed(0).padStart(7)}ms  ${selector}\n` +
				`         snapshots=${result.scannedSnapshots} pages=${result.candidatePages} ` +
				`prefiltered=${result.prefilteredSnapshots} tokenized=${result.tokenizedSnapshots} ` +
				`matchedSnapshots=${result.matchedSnapshots} matchedPages=${result.total}`,
		);
	}

	// Distinct snapshots that a live page references, like the real scan.
	const blobs = [];
	for await (const blob of iterateHtmlBlobs(knex, { chunkSize: Math.min(sample, 200) })) {
		if (blobs.length >= sample) {
			break;
		}
		blobs.push(blob);
	}
	const { ms: decodeMs, value: documents } = await measureMs(() =>
		blobs.map((blob) => decodeStoredBlob(blob.body, blob.codec)),
	);
	const bytes = documents.reduce((sum, html) => sum + Buffer.byteLength(html), 0);
	const megabytes = bytes / 1024 / 1024;
	console.log(
		`\n== sample: ${documents.length} snapshots, ${megabytes.toFixed(1)} MB decoded (decode ${decodeMs.toFixed(0)}ms = ${(megabytes / (decodeMs / 1000)).toFixed(0)} MB/s) ==`,
	);

	console.log('\n== staged vs stack only (decoded sample, decode excluded) ==');
	for (const selector of selectors) {
		const plan = planSelectorMatch(compileSelector(selector));
		const stackOnly = {
			...plan,
			directRegExp: null,
			tokenizedAlternatives: plan.allAlternatives,
		};
		const { ms: stagedMs, value: stagedResults } = await measureMs(() =>
			documents.map((html) => htmlMatchesSelector({ plan, html }).matched),
		);
		const { ms: stackMs, value: stackResults } = await measureMs(() =>
			documents.map((html) => htmlMatchesSelector({ plan: stackOnly, html }).matched),
		);
		const stagedMatches = stagedResults.filter(Boolean).length;
		const stackMatches = stackResults.filter(Boolean).length;
		const disagreements = stackResults.filter(
			(matched, index) => matched !== stagedResults[index],
		).length;
		console.log(
			`staged ${stagedMs.toFixed(0).padStart(6)}ms (${(megabytes / (stagedMs / 1000)).toFixed(0)} MB/s)  ` +
				`stack-only ${stackMs.toFixed(0).padStart(6)}ms (${(megabytes / (stackMs / 1000)).toFixed(0)} MB/s)  ` +
				`matches ${stagedMatches}/${stackMatches}  stage disagreements ${disagreements}  ${selector}`,
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
}

/** Stage-comparison options that take a value (so their value is not an option name). */
const STAGE_OPTIONS_WITH_VALUE = new Set(['--selector', '--sample', '--verify']);

/**
 * Whether the command line asks for a baseline case: an option named
 * `--case` or `--json`, judged by option names only, so a selector or
 * number that happens to read `--json` does not switch modes.
 * @param {string[]} argv - Arguments after the script path.
 * @returns {boolean} `true` for the baseline mode.
 */
function isBaselineMode(argv) {
	for (let i = 0; i < argv.length; i++) {
		if (STAGE_OPTIONS_WITH_VALUE.has(argv[i])) {
			i++;
			continue;
		}
		if (argv[i] === '--case' || argv[i] === '--json') {
			return true;
		}
	}
	return false;
}

if (isBaselineMode(process.argv.slice(2))) {
	await runBaselineCase();
} else {
	await runStageComparison();
}
