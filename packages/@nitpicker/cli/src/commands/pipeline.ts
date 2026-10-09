import type { commandDef } from './pipeline-def.js';
import type { InferFlags } from '@d-zero/roar';

import {
	assertChromeIsInstalled,
	assertPuppeteerSharedWithBeholder,
	PendingUrlsRemainError,
} from '@nitpicker/crawler';

import { resolveRequestHeaders } from '../crawl/resolve-request-headers.js';
import { ExitCode } from '../exit-code.js';
import { formatCliError } from '../format-cli-error.js';

import { CrawlAggregateError } from './crawl-aggregate-error.js';
import { startCrawl } from './crawl.js';
import { report } from './report.js';

/** Parsed flag values for the `pipeline` CLI command. */
type PipelineFlags = InferFlags<typeof commandDef.flags>;

/**
 * Main entry point for the `pipeline` CLI command.
 *
 * Executes the full workflow sequentially: crawl → report.
 * The crawl step generates a `.nitpicker` archive. If `--sheet` is provided,
 * the report step then publishes it to Google Sheets.
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
		console.log('\n📡 [pipeline] Step 1/2: Crawling...');
	}

	let archivePath: string;
	try {
		// Header flags are validated (and `--header-file` read) first, so a
		// malformed header fails before the browser check or any archive I/O —
		// the same order `crawl` itself uses.
		const requestHeaders = await resolveRequestHeaders(flags);
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
			maxAutoRetry: flags.maxAutoRetry,
			list: flags.list,
			listFile: flags.listFile,
			userAgent: flags.userAgent,
			requestHeaders,
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
			// pipeline has no `--recrawl` flag of its own yet — if that changes,
			// add it to `pipeline-def.ts`'s "crawl flags" section and forward
			// `flags.recrawl` here, the same pattern `dedupeCap` follows below.
			recrawl: undefined,
			diff: undefined,
			dedupeCap: flags.dedupeCap,
			dedupeMapCap: flags.dedupeMapCap,
			skipTechnologyJsScan: flags.skipTechnologyJsScan,
			skipTemplates: flags.skipTemplates,
		});
	} catch (error) {
		if (error instanceof PendingUrlsRemainError) {
			// Same rationale as `crawl.ts`'s identical branch (issue #350):
			// an expected, recoverable outcome (`--resume`/`--retry-failed`),
			// not a crash — must not fall through to the generic `throw
			// error` below, which the pipeline's own top-level handler
			// treats as `ExitCode.Fatal`.
			formatCliError(error, verbose);
			process.exit(ExitCode.Incomplete);
		}
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

	// Step 2: Report (only if --sheet is provided)
	if (flags.sheet) {
		if (!silent) {
			// eslint-disable-next-line no-console
			console.log('\n📊 [pipeline] Step 2/2: Reporting...');
		}
		await report([archivePath], {
			html: undefined,
			output: undefined,
			htmlDirs: undefined,
			// pipeline has no `--urls` flag of its own yet — if that changes,
			// thread it through the same way `dedupeCap` is threaded above.
			urls: undefined,
			sheet: flags.sheet,
			// pipeline has no `--sheets` flag of its own yet — same rationale
			// as `urls` above.
			sheets: undefined,
			credentials: flags.credentials,
			all: flags.all,
			dedupeResources: flags.dedupeResources,
			verbose: flags.verbose,
			silent: flags.silent,
		});
	} else if (!silent) {
		// eslint-disable-next-line no-console
		console.log('\n📊 [pipeline] Step 2/2: Skipped (no --sheet specified)');
	}

	if (!silent) {
		// eslint-disable-next-line no-console
		console.log('\n✅ [pipeline] All steps completed.');
	}
}
