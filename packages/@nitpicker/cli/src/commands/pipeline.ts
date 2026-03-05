import type { CommandDef, InferFlags } from '@d-zero/roar';

import { analyze } from './analyze.js';
import { startCrawl } from './crawl.js';
import { report } from './report.js';

/**
 * Command definition for the `pipeline` sub-command.
 * Merges flags from crawl, analyze, and report into a single command
 * that executes the full crawl → analyze → report workflow sequentially.
 * @see {@link pipeline} for the main entry point
 */
export const commandDef = {
	desc: 'Run crawl → analyze → report sequentially',
	flags: {
		// crawl flags
		interval: {
			type: 'number',
			shortFlag: 'I',
			desc: 'An interval time on request when crawles',
		},
		image: {
			type: 'boolean',
			default: true,
			desc: 'Getting images (use --no-image to disable)',
		},
		fetchExternal: {
			type: 'boolean',
			default: true,
			desc: 'Fetch external links (use --no-fetch-external to disable)',
		},
		parallels: {
			type: 'number',
			shortFlag: 'P',
			desc: 'Number of parallel scraping',
		},
		recursive: {
			type: 'boolean',
			default: true,
			desc: 'Recursive crawling (use --no-recursive to disable)',
		},
		scope: {
			type: 'string',
			desc: 'Set hosts and URLs as scope',
		},
		exclude: {
			type: 'string',
			isMultiple: true,
			desc: 'Excluding page URL path (glob pattern)',
		},
		excludeKeyword: {
			type: 'string',
			isMultiple: true,
			desc: 'Exclude keyword in document of page',
		},
		excludeUrl: {
			type: 'string',
			isMultiple: true,
			desc: 'Exclude external URL prefix',
		},
		disableQueries: {
			type: 'boolean',
			shortFlag: 'Q',
			desc: 'Disable queries that the URL has',
		},
		imageFileSizeThreshold: {
			type: 'number',
			desc: 'Image file size threshold',
		},
		single: {
			type: 'boolean',
			desc: 'Single page mode',
		},
		maxExcludedDepth: {
			type: 'number',
			desc: 'Avoid crawling depths above a set number',
		},
		retry: {
			type: 'number',
			default: 3,
			desc: 'Number of retry attempts per URL on scrape failure',
		},
		list: {
			type: 'string',
			isMultiple: true,
			desc: 'Running only each page from the list',
		},
		listFile: {
			type: 'string',
			desc: 'Running only each page from the list file',
		},
		userAgent: {
			type: 'string',
			desc: 'Custom User-Agent string for HTTP requests',
		},
		ignoreRobots: {
			type: 'boolean',
			desc: 'Ignore robots.txt restrictions (use responsibly)',
		},
		output: {
			type: 'string',
			shortFlag: 'o',
			desc: 'Output file path for the .nitpicker archive',
		},
		// analyze flags
		all: {
			type: 'boolean',
			desc: 'Run all analysis plugins and generate all report sheets without interactive prompt',
		},
		plugin: {
			type: 'string',
			isMultiple: true,
			desc: 'Specify plugins to run (e.g. --plugin @nitpicker/analyze-axe --plugin @nitpicker/analyze-textlint)',
		},
		searchKeywords: {
			type: 'string',
			isMultiple: true,
			desc: 'Keywords for analyze-search plugin (overrides config file)',
		},
		searchScope: {
			type: 'string',
			desc: 'CSS selector to narrow search scope for analyze-search plugin (overrides config file)',
		},
		mainContentSelector: {
			type: 'string',
			desc: 'CSS selector for main content detection in analyze-main-contents plugin (overrides config file)',
		},
		axeLang: {
			type: 'string',
			desc: 'BCP 47 language tag for analyze-axe plugin (overrides config file)',
		},
		// report flags
		sheet: {
			shortFlag: 'S',
			type: 'string',
			desc: 'Google Sheets URL (enables the report step)',
		},
		credentials: {
			shortFlag: 'C',
			type: 'string',
			default: './credentials.json',
			desc: 'Path to credentials file (keep this file secure and out of version control)',
		},
		config: {
			shortFlag: 'c',
			type: 'string',
			desc: 'Path to config file',
		},
		limit: {
			shortFlag: 'l',
			type: 'number',
			default: 100_000,
			desc: 'Limit number of rows',
		},
		// shared flags
		verbose: {
			type: 'boolean',
			desc: 'Output verbose log to standard out',
		},
		silent: {
			type: 'boolean',
			desc: 'No output log to standard out',
		},
	},
} as const satisfies CommandDef;

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
 * Each step's errors cause `process.exit(1)`, halting the pipeline.
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
		console.error('Usage: nitpicker pipeline <URL> [options]');
		process.exit(1);
	}

	// Step 1: Crawl
	// eslint-disable-next-line no-console
	console.log('\n📡 [pipeline] Step 1/3: Crawling...');
	const archivePath = await startCrawl([siteUrl], {
		interval: flags.interval,
		image: flags.image,
		fetchExternal: flags.fetchExternal,
		parallels: flags.parallels,
		recursive: flags.recursive,
		scope: flags.scope,
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
		output: flags.output,
		verbose: flags.verbose,
		silent: flags.silent,
		resume: undefined,
		diff: undefined,
	});

	// Step 2: Analyze
	// eslint-disable-next-line no-console
	console.log('\n🔍 [pipeline] Step 2/3: Analyzing...');
	await analyze([archivePath], {
		all: flags.all,
		plugin: flags.plugin,
		verbose: flags.verbose,
		searchKeywords: flags.searchKeywords,
		searchScope: flags.searchScope,
		mainContentSelector: flags.mainContentSelector,
		axeLang: flags.axeLang,
	});

	// Step 3: Report (only if --sheet is provided)
	if (flags.sheet) {
		// eslint-disable-next-line no-console
		console.log('\n📊 [pipeline] Step 3/3: Reporting...');
		await report([archivePath], {
			sheet: flags.sheet,
			credentials: flags.credentials,
			config: flags.config,
			limit: flags.limit,
			all: flags.all,
			verbose: flags.verbose,
			silent: flags.silent,
		});
	} else {
		// eslint-disable-next-line no-console
		console.log('\n📊 [pipeline] Step 3/3: Skipped (no --sheet specified)');
	}

	// eslint-disable-next-line no-console
	console.log('\n✅ [pipeline] All steps completed.');
}
