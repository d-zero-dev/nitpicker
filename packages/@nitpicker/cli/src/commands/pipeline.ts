import type { commandDef } from './pipeline-def.js';
import type { InferFlags } from '@d-zero/roar';

import {
	assertChromeIsInstalled,
	assertPuppeteerSharedWithBeholder,
} from '@nitpicker/crawler';

import { ExitCode } from '../exit-code.js';
import { formatCliError } from '../format-cli-error.js';

import { analyze } from './analyze.js';
import { CrawlAggregateError } from './crawl-aggregate-error.js';
import { startCrawl } from './crawl.js';
import { report } from './report.js';

/** Parsed flag values for the `pipeline` CLI command. */
type PipelineFlags = InferFlags<typeof commandDef.flags>;

/**
 * Main entry point for the `pipeline` CLI command.
 *
 * Executes the full workflow sequentially: crawl → analyze → report.
 * The crawl step generates a `.nitpicker` archive, which is then passed
 * to the analyze step. If `--sheet` is provided, the report step runs
 * last to publish results to Google Sheets.
 *
 * When the crawl step encounters only external link errors and `--strict`
 * is not set, the pipeline exits with code 2 (warning).
 * @param args - Positional arguments; first argument is the root URL to crawl.
 * @param flags - Parsed CLI flags from the `pipeline` command.
 * @returns Resolves when all pipeline steps complete.
 */
export async function pipeline(args: string[], flags: PipelineFlags) {
	const siteUrl = args[0];

	if (!siteUrl) {
		// eslint-disable-next-line no-console
		console.error('Error: No URL specified.');
		// eslint-disable-next-line no-console
		console.error('Usage: npx @nitpicker/cli pipeline <URL> [options]');
		process.exit(ExitCode.Fatal);
	}

	const silent = !!flags.silent;
	const verbose = !!flags.verbose;

	// Step 1: Crawl
	if (!silent) {
		// eslint-disable-next-line no-console
		console.log('\n📡 [pipeline] Step 1/3: Crawling...');
	}

	let archivePath: string;
	try {
		// Fails fast if Chrome is missing, before the crawl step does any
		// archive I/O — see `assertChromeIsInstalled`'s JSDoc.
		await assertChromeIsInstalled();
		assertPuppeteerSharedWithBeholder();

		archivePath = await startCrawl([siteUrl], {
			interval: flags.interval,
			image: flags.image,
			fetchExternal: flags.fetchExternal,
			parallels: flags.parallels,
			recursive: flags.recursive,
			exclude: flags.exclude,
			excludeKeyword: flags.excludeKeyword,
			excludeUrl: flags.excludeUrl,
			disableQueries: flags.disableQueries,
			imageFileSizeThreshold: flags.imageFileSizeThreshold,
			single: flags.single,
			maxExcludedDepth: flags.maxExcludedDepth,
			retry: flags.retry,
			list: flags.list,
			listFile: flags.listFile,
			userAgent: flags.userAgent,
			ignoreRobots: flags.ignoreRobots,
			mainContentSelector: flags.mainContentSelector,
			output: flags.output,
			strict: flags.strict,
			verbose: flags.verbose,
			silent: flags.silent,
			resume: undefined,
			append: [],
			retryFailed: false,
			inventory: undefined,
			diff: undefined,
			dedupeCap: flags.dedupeCap,
			dedupeMapCap: flags.dedupeMapCap,
			skipTechnologyJsScan: flags.skipTechnologyJsScan,
		});
	} catch (error) {
		if (
			error instanceof CrawlAggregateError &&
			error.hasOnlyExternalErrors &&
			!flags.strict
		) {
			formatCliError(error, verbose);
			process.exit(ExitCode.Warning);
		}
		throw error;
	}

	// Step 2: Analyze
	if (!silent) {
		// eslint-disable-next-line no-console
		console.log('\n🔍 [pipeline] Step 2/3: Analyzing...');
	}
	await analyze([archivePath], {
		all: flags.all,
		plugin: flags.plugin,
		verbose: flags.verbose,
		silent: flags.silent,
		searchKeywords: flags.searchKeywords,
		searchScope: flags.searchScope,
		axeLang: flags.axeLang,
		// `pipeline` has no `--templates` flag of its own; template
		// classification's runtime on large archives is unvalidated (see
		// `AnalyzeOptions.classifyTemplates`), so it stays opt-in via the
		// standalone `analyze` command rather than folded into every pipeline run.
		templates: undefined,
	});

	// Step 3: Report (only if --sheet is provided)
	if (flags.sheet) {
		if (!silent) {
			// eslint-disable-next-line no-console
			console.log('\n📊 [pipeline] Step 3/3: Reporting...');
		}
		await report([archivePath], {
			html: undefined,
			output: undefined,
			htmlDirs: undefined,
			sheet: flags.sheet,
			credentials: flags.credentials,
			config: flags.config,
			all: flags.all,
			dedupeResources: flags.dedupeResources,
			verbose: flags.verbose,
			silent: flags.silent,
		});
	} else if (!silent) {
		// eslint-disable-next-line no-console
		console.log('\n📊 [pipeline] Step 3/3: Skipped (no --sheet specified)');
	}

	if (!silent) {
		// eslint-disable-next-line no-console
		console.log('\n✅ [pipeline] All steps completed.');
	}
}
