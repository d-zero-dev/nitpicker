import type { CommandDef, InferFlags } from '@d-zero/roar';

import { assertChromeIsInstalled } from '@nitpicker/crawler';

import { ExitCode } from '../exit-code.js';
import { formatCliError } from '../format-cli-error.js';

import { analyze } from './analyze.js';
import { CrawlAggregateError } from './crawl-aggregate-error.js';
import { startCrawl } from './crawl.js';
import { report } from './report.js';

/**
 * Command definition for the `pipeline` sub-command.
 * Merges flags from crawl, analyze, and report into a single command
 * that executes the full crawl → analyze → report workflow sequentially.
 * @see {@link pipeline} for the main entry point
 */
// TODO: フラグ定義が crawl.ts / analyze.ts / report.ts と重複している。
// @d-zero/roar の CommandDef 型制約により合成が困難なため手動同期が必要。
// crawl / analyze / report にフラグを追加・変更した際はここも更新すること。
export const commandDef = {
	desc: 'Run crawl → analyze → report sequentially',
	usage: '<URL> [options]',
	flags: {
		// crawl flags
		interval: {
			type: 'number',
			shortFlag: 'I',
			valueName: 'ms',
			group: 'Crawl options',
			desc: 'Wait time in milliseconds between requests',
		},
		image: {
			type: 'boolean',
			default: true,
			group: 'Crawl options',
			desc: 'Capture image resources (use --no-image to disable)',
		},
		fetchExternal: {
			type: 'boolean',
			default: true,
			group: 'Crawl options',
			desc: 'Fetch external links (use --no-fetch-external to disable)',
		},
		parallels: {
			type: 'number',
			shortFlag: 'P',
			group: 'Crawl options',
			desc: 'Number of pages to scrape in parallel',
		},
		recursive: {
			type: 'boolean',
			default: true,
			group: 'Crawl options',
			desc: 'Follow links found on crawled pages (use --no-recursive to disable)',
		},
		exclude: {
			type: 'string',
			isMultiple: true,
			valueName: 'glob',
			group: 'Crawl options',
			desc: 'Exclude page URL paths matching the glob pattern (repeatable)',
		},
		excludeKeyword: {
			type: 'string',
			isMultiple: true,
			valueName: 'keyword',
			group: 'Crawl options',
			desc: 'Exclude pages whose document contains the keyword (repeatable)',
		},
		excludeUrl: {
			type: 'string',
			isMultiple: true,
			valueName: 'prefix',
			group: 'Crawl options',
			desc: 'Exclude external URLs starting with the prefix (repeatable)',
		},
		disableQueries: {
			type: 'boolean',
			shortFlag: 'Q',
			group: 'Crawl options',
			desc: 'Strip query strings from URLs when crawling',
		},
		imageFileSizeThreshold: {
			type: 'number',
			valueName: 'bytes',
			group: 'Crawl options',
			desc: 'File-size threshold above which images are excluded',
		},
		single: {
			type: 'boolean',
			group: 'Crawl options',
			desc: 'Crawl only the given URL without following links',
		},
		maxExcludedDepth: {
			type: 'number',
			group: 'Crawl options',
			desc: 'Maximum directory depth for excluded paths. Defaults to 10.',
		},
		retry: {
			type: 'number',
			default: 3,
			group: 'Crawl options',
			desc: 'Number of retry attempts per URL on scrape failure',
		},
		list: {
			type: 'string',
			isMultiple: true,
			valueName: 'URL',
			group: 'Crawl options',
			desc: 'Crawl only the given page URLs (repeat for multiple URLs; disables recursion)',
		},
		listFile: {
			type: 'string',
			valueName: 'file',
			group: 'Crawl options',
			desc: 'Crawl only the page URLs listed in the file, one per line (disables recursion)',
		},
		userAgent: {
			type: 'string',
			valueName: 'string',
			group: 'Crawl options',
			desc: 'Custom User-Agent string for HTTP requests',
		},
		ignoreRobots: {
			type: 'boolean',
			group: 'Crawl options',
			desc: 'Ignore robots.txt restrictions (use responsibly)',
		},
		mainContentSelector: {
			type: 'string',
			valueName: 'selector',
			group: 'Crawl options',
			desc: 'CSS selector overriding automatic main-content-region detection',
		},
		output: {
			type: 'string',
			shortFlag: 'o',
			valueName: 'path',
			group: 'Crawl options',
			desc: 'Output file path for the .nitpicker archive',
		},
		strict: {
			type: 'boolean',
			group: 'Crawl options',
			desc: 'Treat external link errors as fatal (exit code 1 instead of 2)',
		},
		dedupeCap: {
			type: 'number',
			group: 'Crawl options',
			desc: 'Same-cluster soft cap: stop enqueueing newly-discovered internal URLs whose shape (e.g. `/news/date/{n}/`) has accumulated this many matching-title/description/og-tag observations. Opt-in — omit to disable. Backstop against a site that keeps serving 2xx for a self-generating pager/query-parameter trap; see `query dedupe-cap-events` for what fired.',
		},
		dedupeMapCap: {
			type: 'number',
			group: 'Crawl options',
			desc: 'Hard cap on the number of distinct URL shapes --dedupe-cap tracks at once; the least-recently-touched shape is evicted beyond this. Only relevant when --dedupe-cap is set.',
		},
		// analyze flags
		all: {
			type: 'boolean',
			group: 'Analyze options',
			desc: 'Run all analysis plugins and generate all report sheets without interactive prompt',
		},
		plugin: {
			type: 'string',
			isMultiple: true,
			valueName: 'name',
			group: 'Analyze options',
			desc: 'Specify plugins to run (e.g. --plugin @nitpicker/analyze-axe --plugin @nitpicker/analyze-textlint)',
		},
		searchKeywords: {
			type: 'string',
			isMultiple: true,
			valueName: 'keyword',
			group: 'Analyze options',
			desc: 'Keywords for analyze-search plugin (overrides config file)',
		},
		searchScope: {
			type: 'string',
			valueName: 'selector',
			group: 'Analyze options',
			desc: 'CSS selector to narrow search scope for analyze-search plugin (overrides config file)',
		},
		axeLang: {
			type: 'string',
			valueName: 'lang',
			group: 'Analyze options',
			desc: 'BCP 47 language tag for analyze-axe plugin (overrides config file)',
		},
		// report flags
		sheet: {
			shortFlag: 'S',
			type: 'string',
			valueName: 'URL',
			group: 'Report options',
			desc: 'Google Sheets URL (enables the report step)',
		},
		credentials: {
			shortFlag: 'C',
			type: 'string',
			default: './credentials.json',
			valueName: 'path',
			group: 'Report options',
			desc: 'Path to credentials file (keep this file secure and out of version control)',
		},
		config: {
			shortFlag: 'c',
			type: 'string',
			valueName: 'path',
			group: 'Report options',
			desc: 'Path to config file',
		},
		limit: {
			shortFlag: 'l',
			type: 'number',
			default: 100_000,
			group: 'Report options',
			desc: 'Limit number of rows',
		},
		dedupeResources: {
			type: 'boolean',
			group: 'Report options',
			desc: 'Collapse the Resources sheet by canonical URL (query values stripped) and add a Count column. Useful for archives dominated by per-request unique tracking-pixel URLs.',
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
			sheet: flags.sheet,
			credentials: flags.credentials,
			config: flags.config,
			limit: flags.limit,
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
